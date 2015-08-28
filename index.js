var fs = require('vinyl-fs');
var qiniuUpload = require('./lib/qiniu_upload');

module.exports = function(setting, qiniuConfig){
    
	return fs.src(setting.src)
            .pipe(qiniuUpload(qiniuConfig, {
                    dir: setting.dir || setting.dest
                }));
}
