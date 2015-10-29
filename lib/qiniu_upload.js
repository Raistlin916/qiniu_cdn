"use strict";
var PARALLEL = process.env.KDT_NODE_PARALLEL || 20;

var path = require('path')
, through2 = require('through2')
, colors = require('gulp-util').colors
, log = require('gulp-util').log
, fs = require('fs')
, Q = require('q')
, qiniu = require('node-qiniu')
, util = require('util')
, getEtag = require('./etag');


module.exports = function (setting, option, deferred) {
    option = option || {};
    option = extend({dir: ''}, option);

    qiniu.config({
        access_key: setting.accessKey,
        secret_key: setting.secretKey
    });

    var bucket = qiniu.bucket(setting.bucket);

    var qs = []
    , errorFiles = []
    , filesNo = 0;

    function detective(file, fileKey){
        var localHashDefer = Q.defer(), remoteHashDefer = Q.defer();

        getEtag(file.contents, function(hash){
            localHashDefer.resolve(hash);
        });

        var assert = bucket.key(fileKey);

        assert.stat(function(err, stat) {
            if (err) {
                return remoteHashDefer.reject('network_error');
            }
            remoteHashDefer.resolve(stat.hash);
        });

        return Q.all([localHashDefer.promise, remoteHashDefer.promise])
            .then(function(result){
                if(result[0] == undefined){
                    return Q.reject('error');
                }
                if(result[1] == undefined){
                    return Q.resolve('upload');
                }
                if(result[0] == result[1]){
                    return Q.resolve('keep');
                } else {
                    return Q.reject('different');
                }
            });
    }

    function uploadFiles(files){
        var failQs = []
        , qs = files.map(function(item){
            return function(){
                return bucket.putFile(item.fileKey, item.file.path)
                    .then(function(){
                        log('上传完毕', colors.green(item.file.path), '→', colors.green(item.fileKey));
                    })
                    .catch(function(){
                        failQs.push(item);
                        log('上传失败', colors.red(item.file.path), '→', colors.red(item.fileKey));
                    });
            };
        });

        if(qs.length){
            return throat(qs, PARALLEL)
                .then(function(){
                    if(failQs.length){
                        console.log('开始重传', failQs.length, '个文件');
                        return uploadFiles(failQs);
                    }
                });
        } else {
            return [];
        }
        
    }

    var countKeep = 0,
        countUpload = 0;
    return through2.obj(function (file, enc, next) {
        var that = this;
        if (file._contents === null) return next();

        var filePath = path.relative(file.base, file.path)
        , fileKey = option.dir + ((!option.dir || option.dir[option.dir.length - 1]) === '/' ? '' : '/') + filePath;

        qs.push(function(){
            return detective(file, fileKey)
                .then(function(action){
                    if(action == 'upload'){
                        countUpload++;
                    } else {
                        countKeep++;
                    }

                    process.stdout.clearLine();
                    process.stdout.cursorTo(0);
                    process.stdout.write('相同: ' + countKeep+ '\t需要上传: ' 
                            + countUpload + '\t错误:' + errorFiles.length);

                    if(action == 'upload'){
                        return {file: file, fileKey: fileKey};
                    }
                })
                .catch(function(e){
                    errorFiles.push({
                        fileKey: fileKey,
                        error: e
                    });
                });
        });

        next();
    }, function (next) {

        throat(qs, PARALLEL)
            .then(function(result){
                process.stdout.write('\n');
                errorFiles.forEach(function(item){
                    log(colors.red(item.error), item.fileKey);
                });
                result = result.filter(function(item){return item != undefined;});
                return uploadFiles(result);
            })
            .then(deferred && deferred.resolve)
            .catch(function(reason){
                dumpError(reason);
            });
    });
}

function extend(target, source) {
    target = target || {};
    for (var prop in source) {
        if (typeof source[prop] === 'object') {
            target[prop] = extend(target[prop], source[prop]);
        } else {
            target[prop] = source[prop];
        }
    }
    return target;
}

function throat(qs, orgNum){
    var point = orgNum - 1
    , count = 0
    , d = Q.defer()
    , result = [];

    qs.slice(0, point + 1).forEach(function(fn){
        return fn().then(check).catch(dumpError);
    });
    function check(r){
        result.push(r);
        point ++;
        count ++;
        if(count == qs.length){
            d.resolve(result);
            return;
        }
        if(point >= qs.length){
            return;
        }
        var fn = qs[point];
        return fn().then(check);
    }
    return d.promise;
}

function dumpError(err) {
  if (typeof err === 'object') {
    if (err.message) {
      console.error('\nMessage: ' + err.message)
    }
    if (err.stack) {
      console.error('\nStacktrace:')
      console.error('====================')
      console.error(err.stack);
    }
  } else {
    console.error('dumpError :: argument is not an object');
  }
}

