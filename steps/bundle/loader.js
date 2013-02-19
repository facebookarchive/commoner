exports.name = "prepend-installer";
exports.version = 3;

var getCode = require("install").getCode;
var minify = require("uglify-js").minify;
var Q = require("q");

var deferred = Q.defer();
var promise = deferred.promise;

getCode(function(err, code) {
    if (err) {
        deferred.reject(err);
    } else {
        deferred.resolve(minify(code, {
            fromString: true
        }).code);
    }
});

exports.build = function(context, source) {
    if (context.bundle.parent)
        return source;

    return promise.then(function(code) {
        return [code, source].join("\n");
    });
};
