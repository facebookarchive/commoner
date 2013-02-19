var getCode = require("install").getCode;
var Q = require("q");

exports.name = "prepend-installer";

exports.version = 2;

exports.build = function(context, source) {
    if (context.bundle.parent)
        return source;

    var deferred = Q.defer();

    getCode(function(err, code) {
        if (err) {
            deferred.reject(err);
        } else {
            var result = [code, source].join("\n");
            deferred.resolve(result);
        }
    });

    return deferred.promise;
};
