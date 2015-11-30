qiniu_cdn
=========

七牛cdn上传模块


Usage
======

First, install qiniu_cdn as a development dependency:

	npm install qiniu_cdn --save

Then

	var qiniuUpload = require('./qiniu_cdn');

	qiniuUpload({
	    src: 'dir/**',
    	dest: 'key/'
	},{
    	accessKey: 'xxxxxxx',
	    secretKey: 'xxxx',
    	bucket: "xxxx"
	});
