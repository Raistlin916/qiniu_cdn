var fs = require('vinyl-fs');
var qiniuUpload = require('./lib/qiniu_upload');

var posix = require('posix');
posix.setrlimit('nofile', { soft: 10000, hard: 10000 });

module.exports = function(setting, qiniuConfig){
    return fs.src(setting.src)
            .pipe(qiniuUpload(qiniuConfig, {
                    dir: setting.dir
                }));
}