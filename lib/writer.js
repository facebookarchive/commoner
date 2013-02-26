var assert = require("assert");
var Q = require("q");
var fs = require("fs");
var path = require("path");
var createHash = require("crypto").createHash;

var BuildContext = require("./context").BuildContext;
var util = require("./util");

function BundleWriter(context, builders) {
    var self = this;
    assert.ok(self instanceof BundleWriter);
    assert.ok(context instanceof BuildContext);

    var hash = createHash("sha1").update(context.configHash + "\0");

    builders = builders ? builders.slice(0) : [];
    builders.push(uglify);
    builders.push(installer);
    builders.forEach(function(build) {
        assert.strictEqual(typeof build, "function");
        hash.update(build + "\0");
    });

    Object.defineProperties(self, {
        context: { value: context },
        builders: { value: builders },
        salt: { value: hash.digest("hex") }
    });
}

BundleWriter.prototype = {
    writeP: function(bundleP) {
        var writer = this;

        return Q.resolve(bundleP).then(function(bundle) {
            var hash = createHash("sha1")
                .update(bundle.hash)
                .update(writer.salt)
                .digest("hex");

            var fileName = hash + ".js";
            var fullPath = path.join(writer.context.outputDir, fileName);

            return util.existsP(fullPath).then(function(exists) {
                if (exists)
                    return fileName;

                var promise = Q.resolve(bundle.getSource());

                writer.builders.forEach(function(build) {
                    promise = promise.then(function(source) {
                        return build.call(writer.context, bundle, source);
                    });
                });

                return promise.then(function(source) {
                    return util.writeP(fullPath, source).then(function() {
                        return fileName;
                    });
                });
            });
        });
    }
};

exports.BundleWriter = BundleWriter;

function uglify(bundle, source) {
    if (this.config.debug)
        return source;

    return util.minify(source, "require");
}

var installer = (function() {
    var deferred = Q.defer();
    var installerP = deferred.promise;

    require("install").getCode(function(err, code) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(util.minify(code));
        }
    });

    return function installer(bundle, source) {
        if (bundle.parent)
            return source;

        return installerP.then(function(code) {
            return [code, source].join("\n");
        });
    };
})();
