var assert = require("assert");
var fs = require("fs");
var path = require("path");
var Q = require("q");
var createHash = require("crypto").createHash;

var defaultSteps = [
    require("../steps/module/wrap")
];

function ModuleReader(sourceDir) {
    var self = this;
    assert.ok(self instanceof ModuleReader);

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        steps: { value: defaultSteps.slice(0) }
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

        var promise = deferred.promise.then(function(source) {
            hash.update(source.length + "\0" + source);
            return [hash.digest("hex"), source];
        });

        builders.forEach(function(build) {
            promise = promise.spread(function(hash, source) {
                return Q.all([hash, build(id, source)]);
            });
        });

        return promise.spread(function(hash, source) {
            return new Module(reader, id, hash, source);
        });
    },

    readMultiP: function(ids) {
        return Q.all(ids.map(this.readModuleP, this));
    }
};

exports.ModuleReader = ModuleReader;

function Module(reader, id, hash, source) {
    var self = this;

    assert.ok(self instanceof Module);
    assert.ok(reader instanceof ModuleReader);
    assert.strictEqual(typeof source, "string");

    Object.defineProperties(self, {
        reader: { value: reader },
        id: { value: id },
        hash: { value: hash },
        source: { value: source }
    });
}

Module.prototype = {
    getRequiredP: function() {
        var install = require("install");
        var ids = install.getRequiredIDs(this.id, this.source);
        return this.reader.readMultiP(ids);
    },

    toString: function() {
        return "Module(" + JSON.stringify(this.id) + ")";
    },

    resolveId: function(id) {
        return path.join(this.id, "..", id);
    }
};
