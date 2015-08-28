var fs = require('vinyl-fs');
var qiniuUpload = require('./lib/qiniu_upload');

module.exports = function(setting, qiniuConfig){
    if (setting.drc == undefined) {
	console.log('前缀为空，请执行 npm install 升级node_modules!!!!!');
	return throw new Error('前缀为空，请执行 npm install 升级node_modules!!!!!');
    }
    return fs.src(setting.src)
            .pipe(qiniuUpload(qiniuConfig, {
                    dir: setting.dir
                }));
}
