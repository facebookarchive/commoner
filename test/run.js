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

var debugContext = new BuildContext({
    debug: true
}, sourceDir, outputDir, []);

var releaseContext = new BuildContext({
    debug: false
}, sourceDir, outputDir, []);

function getSourceP(id) {
    return this.readFileP(id + ".js");
}

function waitForHelpers(t, helperP) {
    Q.all([
        helperP(debugContext),
        helperP(releaseContext)
    ]).done(t.finish.bind(t));
}

exports.testModuleReader = function(t, assert) {
    var reader = new ModuleReader(debugContext, [getSourceP], []);

    reader.readModuleP("home").then(function(home) {
        assert.strictEqual(home.id, "home");
        assert.strictEqual(typeof home.source, "string");
        assert.notEqual(home.source.indexOf("exports"), -1);
        assert.strictEqual(home.source.indexOf("install"), 0);
        return home;
    }).invoke("getRequiredP").then(function(reqs) {
        assert.strictEqual(reqs.length, 1);
        assert.strictEqual(reqs[0].id, "assert");
    }).done(t.finish.bind(t));
};

exports.testReaderCaching = function(t, assert) {
    var reader = new ModuleReader(debugContext, [getSourceP], []);

    var homes = [
        reader.readModuleP("home"),
        reader.readModuleP("home"),
        reader.noCacheReadModuleP("home")
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

    function traverse(a, b) {
        var aks = Object.keys(a);
        assert.deepEqual(aks, Object.keys(b));

        aks.forEach(function(id) {
            var aVal = a[id];
            var bVal = b[id];
            assert.ok(bVal.file);
            if (bVal.then) {
                traverse(aVal, bVal.then);
            } else {
                assert.deepEqual(aVal, {});
            }
        });
    }

    function helperP(context) {
        var pipeline = makePipeline(context).setSchema(schema);
        return pipeline.getTreeP().then(function(tree) {
            traverse(schema, tree);
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

exports.testFindDirective = function(t, assert) {
    Q.all([
        util.findDirectiveP("providesModule", sourceDir),
        debugContext.getProvidedP()
    ]).spread(function(pathToValue, valueToPath) {
        assert.deepEqual(pathToValue, {
            "widget/share.js": "WidgetShare"
        });
        assert.deepEqual(valueToPath, {
            "WidgetShare": "widget/share.js"
        });
    }).done(t.finish.bind(t));
};
