var assert = require("assert");
var fs = require("fs");
var path = require("path");
var Q = require("q");
var createHash = require("crypto").createHash;

var defaultSteps = [
    require("../steps/module/deps"),
    require("../steps/module/wrap")
];

function ModuleReader(sourceDir) {
    var self = this;
    assert.ok(self instanceof ModuleReader);

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        steps: { value: defaultSteps.slice(0) },
        promiseCache: { value: {} }
    });
}

ModuleReader.prototype = {
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

    readModuleP: function(id) {
        var cache = this.promiseCache;
        if (cache.hasOwnProperty(id))
            return cache[id];

        var deferred = Q.defer();
        var promise = deferred.promise;

        // TODO Invalidate cache when files change on disk.
        cache[id] = promise;

        this.noCacheReadModuleP(id).then(function(module) {
            deferred.resolve(module);
        }, function(err) {
            deferred.reject(err);
        });

        return promise;
    },

    noCacheReadModuleP: function(id) {
        var reader = this;
        var file = path.resolve(reader.sourceDir, id + ".js");
        var deferred = Q.defer();
        var promise = deferred.promise;

        fs.readFile(file, "utf-8", function(err, source) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(source);
            }
        });

        var hash = createHash("sha1").update("module\0" + id + "\0");

        var builders = reader.steps.map(function(step) {
            hash.update(step.name + "\0" + step.version + "\0");
            return step.build;
        });

        var context;
        var promise = deferred.promise.then(function(source) {
            hash.update(source.length + "\0" + source);
            context = new BuildContext(id, reader, hash.digest("hex"));
            return source;
        });

        builders.forEach(function(build) {
            promise = promise.then(function(source) {
                return build(context, source);
            });
        });

        return promise.then(function(source) {
            return new Module(context, source);
        });
    },

    readMultiP: function(ids) {
        return Q.all(ids.map(this.readModuleP, this));
    }
};

exports.ModuleReader = ModuleReader;

function BuildContext(id, reader, hash) {
    var self = this;

    assert.ok(self instanceof BuildContext);
    assert.ok(reader instanceof ModuleReader);
    assert.strictEqual(typeof hash, "string");

    Object.defineProperties(self, {
        id: { value: id },
        reader: { value: reader },
        hash: { value: hash },
        deps: { value: [] }
    });
}

function Module(context, source) {
    var self = this;

    assert.ok(self instanceof Module);
    assert.ok(context instanceof BuildContext);
    assert.strictEqual(typeof source, "string");

    Object.defineProperties(self, {
        context: { value: context },
        id: { value: context.id },
        hash: { value: context.hash },
        source: { value: source }
    });
}

Module.prototype = {
    getRequiredP: function() {
        var ctx = this.context;
        return ctx.reader.readMultiP(ctx.deps);
    },

    toString: function() {
        return "Module(" + JSON.stringify(this.id) + ")";
    },

    resolveId: function(id) {
        return path.join(this.id, "..", id);
    }
};
