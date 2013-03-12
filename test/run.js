var Watcher = require("../lib/watcher").Watcher;
var BuildContext = require("../lib/context").BuildContext;
var ModuleReader = require("../lib/reader").ModuleReader;
var BundleWriter = require("../lib/writer").BundleWriter;
var Pipeline = require("../lib/pipeline").Pipeline;
var makeBundleP = require("../lib/bundle").makeBundleP;
var util = require("../lib/util");
var fs = require("fs");
var Q = require("q");

var path = require("path");
var sourceDir = path.resolve(__dirname, "source");
var outputDir = path.resolve(__dirname, "output");

try {
    fs.mkdirSync(outputDir);
} catch (exists) {
    // pass
}

var watcher = new Watcher(sourceDir);

var debugContext = new BuildContext({
    debug: true
}, watcher, outputDir, []);

var releaseContext = new BuildContext({
    debug: false
}, watcher, outputDir, []);

function getSourceP(id) {
    return this.readFileP(id + ".js");
}

function waitForHelpers(t, helperP) {
    Q.all([
        helperP(debugContext),
        helperP(releaseContext)
    ]).done(t.finish.bind(t));
}

function checkHome(assert, home) {
    return Q.resolve(home).then(function(home) {
        assert.strictEqual(home.id, "home");
        assert.strictEqual(typeof home.source, "string");
        assert.notEqual(home.source.indexOf("exports"), -1);
        assert.strictEqual(home.source.indexOf("install"), 0);
        return home;
    }).invoke("getRequiredP").then(function(reqs) {
        assert.strictEqual(reqs.length, 1);
        assert.strictEqual(reqs[0].id, "assert");
    });
}

exports.testModuleReader = function(t, assert) {
    var reader = new ModuleReader(debugContext, [getSourceP], []);
    var homeP = reader.readModuleP("home");
    checkHome(assert, homeP).done(t.finish.bind(t));
};

exports.testMissingModuleWarning = function(t, assert) {
    function helperP(context) {
        var reader = new ModuleReader(context, [getSourceP], []);
        var id = "this/module/should/not/exist";
        return reader.readModuleP(id).then(function(module) {
            assert.strictEqual(module.id, id);
            assert.notEqual(module.source.indexOf("throw new Error"), -1);
        });
    }

    waitForHelpers(t, helperP);
};

exports.testSkipFailingResolvers = function(t, assert) {
    var reader = new ModuleReader(debugContext, [function(id) {
        return this.makePromise(function(callback) {
            process.nextTick(function() {
                callback(new Error("bad thing happen"));
            });
        });
    }, function(id) {
        throw new Error("superbad situation");
    }, getSourceP], []);

    var homeP = reader.readModuleP("home");
    checkHome(assert, homeP).done(t.finish.bind(t));
};

exports.testReaderCaching = function(t, assert) {
    var reader = new ModuleReader(debugContext, [getSourceP], []);

    var homes = [
        reader.readModuleP("home"),
        reader.readModuleP("home"),
        reader.readModuleP.originalFn.call(reader, "home")
    ];

    assert.strictEqual(homes[0], homes[1]);
    assert.notStrictEqual(homes[0], homes[2]);
    assert.notStrictEqual(homes[1], homes[2]);

    Q.all(homes).spread(function(h0, h1, h2) {
        assert.strictEqual(h0, h1);
        assert.strictEqual(h0, h2);
        assert.strictEqual(h1, h2);

        assert.strictEqual(h0.hash, h1.hash);
        assert.strictEqual(h1.hash, h2.hash);
    }).done(t.finish.bind(t));
};

function makePipeline(context) {
    var reader = new ModuleReader(context, [getSourceP], []);
    var writer = new BundleWriter(context, []);
    return new Pipeline(context, reader, writer);
}

exports.testSimpleSchema = function(t, assert) {
    function helperP(context) {
        return makePipeline(context).setSchema({
            home: {}
        }).getTreeP().then(function(tree) {
            assert.ok(tree.home);
            assert.ok(tree.home.file);
            assert.ok(/\.js$/.test(tree.home.file));
        });
    }

    waitForHelpers(t, helperP);
};

function checkTree(assert, schema, tree) {
    var aks = Object.keys(schema);
    assert.deepEqual(aks, Object.keys(tree));

    aks.forEach(function(id) {
        var sVal = schema[id];
        var tVal = tree[id];
        assert.ok(tVal.file);
        if (tVal.then) {
            checkTree(assert, sVal, tVal.then);
        } else {
            assert.deepEqual(sVal, {});
        }
    });
}

exports.testComplexSchema = function(t, assert) {
    var schema = {
        "core": {
            "login": {
                "tests/login": {}
            },
            "home": {
                "tests/home": {}
            },
            "settings": {
                "tests/settings": {}
            }
        }
    };

    function helperP(context) {
        var pipeline = makePipeline(context).setSchema(schema);
        return pipeline.getTreeP().then(function(tree) {
            checkTree(assert, schema, tree);
        });
    }

    waitForHelpers(t, helperP);
};

exports.testSchemaWithEmptyBundles = function(t, assert) {
    var schema = {
        "core": {
            "home": {
                "assert": {
                    "settings": {}
                }
            },
            "assert": {
                "home": {}
            }
        }
    };

    function assertNotEmpty(entry) {
        assert.ok(entry);
        assert.strictEqual(typeof entry.empty, "undefined");
    }

    function assertEmpty(entry) {
        assert.ok(entry);
        assert.strictEqual(entry.empty, true);
    }

    function helperP(context) {
        var pipeline = makePipeline(context).setSchema(schema);

        return pipeline.getTreeP().then(function(tree) {
            assertNotEmpty(tree.core);
            assertNotEmpty(tree.core.then.home);
            assertEmpty(tree.core.then.home.then.assert);
            assertNotEmpty(tree.core.then.home.then.assert.then.settings);
            assertNotEmpty(tree.core.then.assert);
            assertNotEmpty(tree.core.then.assert.then.home);
            checkTree(assert, schema, tree);
        });
    }

    waitForHelpers(t, helperP);
};

exports.testBundle = function(t, assert) {
    function helperP(context) {
        var reader = new ModuleReader(context, [getSourceP], []);

        return reader.readModuleP("home").then(function(homeModule) {
            return makeBundleP(homeModule);
        }).then(function(bundle) {
            var homeModule = bundle.get("home");
            var assertModule = bundle.get("assert");
            assert.ok(homeModule);
            assert.ok(assertModule);
            assert.strictEqual(homeModule.id, "home");
            assert.strictEqual(assertModule.id, "assert");
        });
    }

    waitForHelpers(t, helperP);
};

function writeAndCheckExistsP(writer, module) {
    var deferred = Q.defer();
    writer.writeP(module).then(function(fileName) {
        var filePath = path.join(outputDir, fileName);
        fs.exists(filePath, function(exists) {
            deferred.resolve(exists);
        });
    });
    return deferred.promise;
}

function clearOutputSync(outputDir) {
    fs.readdirSync(outputDir).forEach(function(file) {
        fs.unlinkSync(path.join(outputDir, file));
    });

    fs.rmdirSync(outputDir);
    fs.mkdirSync(outputDir);
}

exports.testBundleWriter = function(t, assert) {
    function helperP(context) {
        var reader = new ModuleReader(context, [getSourceP], []);
        var writer = new BundleWriter(context, []);

        return reader.readModuleP("home").then(function(home) {
            assert.strictEqual(home.id, "home");
            return writeAndCheckExistsP(writer, makeBundleP(home));
        }).then(function(exists) {
            assert.strictEqual(exists, true);
        });
    }

    waitForHelpers(t, helperP);
};

exports.testGrepP = function(t, assert) {
    Q.all([
        watcher.grepP("@providesModule\\s\\+\\S\\+"),
        debugContext.getProvidedP()
    ]).spread(function(pathToMatch, valueToPath) {
        assert.deepEqual(pathToMatch, {
            "widget/share.js": "@providesModule WidgetShare"
        });
        assert.deepEqual(valueToPath, {
            "WidgetShare": "widget/share.js"
        });
    }).done(t.finish.bind(t));
};

exports.testMakePromise = function(t, assert) {
    var error = new Error("test");

    function helperP(context) {
        return context.makePromise(function(callback) {
            process.nextTick(function() {
                callback(error, "asdf");
            });
        }).then(function() {
            assert.ok(false, "should have thrown an error");
        }, function(err) {
            assert.strictEqual(err, error);

            return context.makePromise(function(callback) {
                process.nextTick(function() {
                    callback(null, "success");
                });
            }).then(function(result) {
                assert.strictEqual(result, "success");
            });
        })
    }

    waitForHelpers(t, helperP);
};
