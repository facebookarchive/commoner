var assert = require("assert");
var Q = require("q");
var fs = require("fs");
var path = require("path");
var createHash = require("crypto").createHash;

var defaultSteps = [
    require("../steps/bundle/loader"),
    require("../steps/bundle/uglify")
];

function BundleWriter(outputDir) {
    var self = this;
    assert.ok(self instanceof BundleWriter);

    Object.defineProperties(self, {
        steps: { value: defaultSteps.slice(0) },
        outputDir: { value: outputDir }
    });
}

BundleWriter.prototype = {
    setSteps: function() {
        var steps = this.steps;
        steps.length = 0;
        Array.prototype.forEach.call(arguments, function(step) {
            assert.strictEqual(typeof step.name, "string");
            assert.ok("version" in step);
            assert.strictEqual(typeof step.build, "function");
            steps.push(step);
        });
        return this;
    },

    writeP: function(bundleP) {
        var writer = this;

        return Q.resolve(bundleP).then(function(bundle) {
            var hash = createHash("sha1").update(bundle.hash);

            var builders = writer.steps.map(function(step) {
                hash.update("\0" + step.name + "\0" + step.version);
                return step.build;
            });

            var context = new BuildContext(bundle, hash.digest("hex"));
            var fileName = context.hash + ".js";
            var fullPath = path.join(writer.outputDir, fileName);

            return existsP(fullPath).then(function(exists) {
                if (exists)
                    return fileName;

                var promise = Q.resolve(bundle.getSource());

                builders.forEach(function(build) {
                    promise = promise.then(function(source) {
                        return build(context, source);
                    });
                });

                return promise.then(function(built) {
                    return writeP(fullPath, built).then(function() {
                        return fileName;
                    });
                });
            });
        });
    }
};

function BuildContext(bundle, hash) {
    var self = this;

    assert.ok(self instanceof BuildContext);
    assert.strictEqual(typeof hash, "string");

    Object.defineProperties(self, {
        bundle: { value: bundle },
        hash: { value: hash }
    });
}

function existsP(fullPath) {
    var deferred = Q.defer();

    fs.exists(fullPath, function(exists) {
        deferred.resolve(exists);
    });

    return deferred.promise;
}

function writeP(fullPath, source) {
    var deferred = Q.defer();

    fs.writeFile(fullPath, source, function(err) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(source);
        }
    });

    return deferred.promise;
}

exports.BundleWriter = BundleWriter;
