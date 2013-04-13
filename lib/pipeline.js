var assert = require("assert");
var BuildContext = require("./context").BuildContext;
var ModuleReader = require("./reader").ModuleReader;
var BundleWriter = require("./writer").BundleWriter;
var makeBundleP = require("./bundle").makeBundleP;
var Q = require("q");

function Pipeline(context, reader, writer) {
    var self = this;

    assert.ok(self instanceof Pipeline);
    assert.ok(context instanceof BuildContext)
    assert.ok(reader instanceof ModuleReader);
    assert.ok(writer === null ||
              writer instanceof BundleWriter);

    var tree;

    Object.defineProperties(self, {
        context: { value: context },

        setSchema: {
            value: function(schema) {
                if (schema instanceof Array) {
                    tree = rootsToSchemaTree(schema);
                } else {
                    // Make a defensive copy.
                    tree = JSON.parse(JSON.stringify(schema));
                }
                return self;
            }
        },

        getTreeP: {
            value: function() {
                assert.ok(tree, "must call setSchema before calling getTreeP");
                return getTreeP(tree);
            }
        }
    })

    function getTreeP(tree, parent) {
        var result = {};

        return Q.all(Object.keys(tree).map(function(id) {
            var entry = result[id] = {};
            var moduleP = reader.readModuleP(id);
            var bundleP = makeBundleP(moduleP, parent);

            // TODO Allow relative IDs.

            return Q.all([
                writer && writer.writeBundleP(bundleP),
                bundleP.get("empty"),
                getTreeP(tree[id], bundleP)
            ]).spread(function(fileName, empty, branches) {
                if (fileName) {
                    entry.file = fileName;
                }

                if (empty) {
                    entry.empty = true;
                }

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

function rootsToSchemaTree(roots, i) {
    i = i || 0;
    var tree = {};

    if (i < roots.length) {
        var rest = rootsToSchemaTree(roots, i + 1);
        if (rest) {
            tree[roots[i]] = rest;
            for (var key in rest)
                if (rest.hasOwnProperty(key))
                    tree[key] = rest[key];
        }
    }

    return tree;
}
