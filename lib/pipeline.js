var assert = require("assert");
var ModuleReader = require("./reader").ModuleReader;
var BundleWriter = require("./writer").BundleWriter;
var makeBundleP = require("./bundle").makeBundleP;
var Q = require("q");

function Pipeline(reader, writer) {
    var self = this;

    assert.ok(self instanceof Pipeline);
    assert.ok(reader instanceof ModuleReader);
    assert.ok(writer instanceof BundleWriter);

    var tree;

    self.setSchema = function(schema) {
        tree = JSON.parse(JSON.stringify(schema));
        return self;
    };

    self.getTreeP = function() {
        assert.ok(tree, "must call setSchema before calling getTreeP");
        return getTreeP(tree);
    };

    function getTreeP(tree, parent) {
        var result = {};

        return Q.all(Object.keys(tree).map(function(id) {
            var entry = result[id] = {};
            var moduleP = reader.readModuleP(id);
            var bundleP = makeBundleP(moduleP, parent);

            // TODO Allow relative IDs.

            return Q.all([
                writer.writeP(bundleP),
                getTreeP(tree[id], bundleP)
            ]).spread(function(fileName, branches) {
                entry.file = fileName;
                for (var _ in branches) {
                    entry.then = branches;
                    break;
                }
            });
        })).then(function() {
            return result;
        });
    }
}

exports.Pipeline = Pipeline;
