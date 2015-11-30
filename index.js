var nodeQiniu = require('node-qiniu');
var through = require('through2');
var fs = require('vinyl-fs');
var Q = require('q');
var getEtag = require('./lib/etag');
var util = require('./lib/util');
var highWaterMark = 2 * 1024 * 1024 * 1024; // 2G

module.exports = function(upload, auth, callback) {
    nodeQiniu.config({
        access_key: auth.accessKey,
        secret_key: auth.secretKey
    });
    var  context = {
        needUploadNum: 0, // 需要上传数量
        alreadyUploadNum: 0, // 已上传数量
        modifyFilesNum: 0, // 已上传，但本地修改数量
        errorCheckNum: 0, // 错误处理数量

        logCheckDefer: Q.defer(),
        uploadDefer: Q.defer(),
        logUploadFailDefer: Q.defer(),

        qiniu: nodeQiniu.bucket(auth.bucket),

        errors: []
    };

    return fs.src(upload.src)
        .pipe(init(upload)) // 初始化属性值

        .pipe(checkRemoteFile(context)) // 是否存在文件
        .pipe(checkRemoteFile(context)) // retry
        .pipe(checkRemoteFile(context)) // retry
        .on('end', function() {
            console.log();
            context.logCheckDefer.resolve();
        })
        .pipe(logCheckFailed(context))
        .on('end', function() {
            context.uploadDefer.resolve();
        })

        .pipe(uploadFile(context)) // 上传文件
        .pipe(uploadFile(context)) // retry
        .pipe(uploadFile(context)) // retry
        .on('end', function() {
            context.logUploadFailDefer.resolve();
        })
        .pipe(logUploadFail(context))
        .on('end', function() {
            if (callback) {
                callback(context.errors.join(','), context);
            }
        })
        // the end;
        .pipe(through.obj());
};

function init(upload) {
    return through.obj({highWaterMark: highWaterMark}, function(file, encoding, next) {
        var cdnpath = util.getCdnPath(file, upload);

        file.checkTryCount = 0;
        file.uploadTryCount = 0;
        file.cdnPath = cdnpath;
        file.needCheck = file.stat.isFile();
        file.needUpload = false;
        file.needCompare = false;

        next(null, file);
    });
}

function checkRemoteFile(context) {
    return through.obj({highWaterMark: highWaterMark}, function(file, encoding, next) {
        if (file.needCheck) {
            var assert = context.qiniu.key(file.cdnPath);
            assert.stat(function(error, result) {
                if (error) {
                    context.errorCheckNum++;

                    file.needCheck = true;
                    file.checkFailMsg = '检查文件出错';
                    file.checkFailRes = JSON.stringify(error);
                    file.checkTryCount++;

                    pass();
                } else {
                    getEtag(file.contents, function(hash) {
                        // 无hash值，cdn上没有文件，待上传
                        if (!result.hash) {
                            file.needCheck = false;
                            file.needUpload = true;
                            context.needUploadNum++;
                        }
                        // 本地hash计算出错
                        else if (!hash) {
                            file.needCheck = true;
                            file.checkTryCount++;
                            context.errorCheckNum++;
                        }
                        // 对比本地hash与cdn上的hash值
                        else {
                            file.needCheck = false;
                            file.needUpload = false;
                            (result.hash == hash) ? context.alreadyUploadNum++ : context.modifyFilesNum++;
                        }

                        pass();
                    });
                }

                function pass() {
                    // 重试错误计算
                    if (file.checkTryCount > 1) {
                        context.errorCheckNum--;
                    }

                    next(null, file);
                    util.logCheck(context.alreadyUploadNum + context.modifyFilesNum, context.needUploadNum, context.errorCheckNum);
                }
            });
        } else {
            next(null, file);
        }
    });
}

function logCheckFailed(context) {
    return through.obj({highWaterMark: highWaterMark}, function(file, encoding, next) {
        if (file.needCheck) {
            context.logCheckDefer.promise.then(function() {
                util.logCheckFail(file);
                context.errors.push(file.checkFailRes);
            });
        }
        next(null, file);
    });
}

function uploadFile(context) {
    return through.obj({highWaterMark: highWaterMark}, function(file, encoding, next) {
        if (file.needUpload) {
            context.qiniu.putFile(file.cdnPath, file.path, function(error, result) {
                file.uploadSuccess = false;
                if (error) {
                    file.uploadFailMsg = '上传出错';
                    file.uploadFailRes = JSON.stringify(error);
                    file.uploadTryCount++;
                } else {
                    file.uploadSuccess = true;
                    file.needUpload = false;

                    context.uploadDefer.promise.then(function() {
                        util.logUploadSuccess(file);
                    });
                }

                next(null, file);
            });
        } else {
            next(null, file);
        }
    });
}

function logUploadFail(context) {
    return through.obj({highWaterMark: highWaterMark}, function(file, encoding, next) {
        if (file.needUpload) {
            context.logUploadFailDefer.promise.then(function() {
                util.logUploadFail(file);
                context.errors.push(file.uploadFailRes);
            });
        }
        next(null, file);
    });
}
