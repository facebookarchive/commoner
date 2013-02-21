var ModuleReader = require("../lib/reader").ModuleReader;
var BundleWriter = require("../lib/writer").BundleWriter;
var Pipeline = require("../lib/pipeline").Pipeline;
var makeBundleP = require("../lib/bundle").makeBundleP;
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

exports.testModuleReader = function(t, assert) {
    var reader = new ModuleReader(sourceDir);

    reader.readModuleP("home").then(function(home) {
        assert.strictEqual(home.id, "home");
        assert.strictEqual(typeof home.source, "string");
        assert.notEqual(home.source.indexOf("exports"), -1);
        return home;
    }).invoke("getRequiredP").then(function(reqs) {
        assert.strictEqual(reqs.length, 1);
        assert.strictEqual(reqs[0].id, "assert");
    }).done(t.finish.bind(t));
};

exports.testReaderSteps = function(t, assert) {
    var rawReader = new ModuleReader(sourceDir).setSteps();
    var wrappedReader = new ModuleReader(sourceDir).setSteps(
        require("../steps/module/wrap"));

    Q.all([
        rawReader.readModuleP("home"),
        wrappedReader.readModuleP("home")
    ]).spread(function(raw, wrapped) {
        assert.strictEqual(raw.source.indexOf("install"), -1);
        assert.strictEqual(wrapped.source.indexOf("install"), 0);
    }).done(t.finish.bind(t));
};

exports.testReaderCaching = function(t, assert) {
    var reader = new ModuleReader(sourceDir);

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

        assert.notStrictEqual(h0, h2);
        assert.notStrictEqual(h1, h2);

        assert.strictEqual(h0.hash, h1.hash);
        assert.strictEqual(h1.hash, h2.hash);
    }).done(t.finish.bind(t));
};

function makePipeline() {
    var reader = new ModuleReader(sourceDir);
    var writer = new BundleWriter(outputDir);
    return new Pipeline(reader, writer);
}

exports.testSimpleSchema = function(t, assert) {
    makePipeline().setSchema({
        home: {}
    }).getTreeP().then(function(tree) {
        assert.ok(tree.home);
        assert.ok(tree.home.file);
        assert.ok(/\.js$/.test(tree.home.file));
    }).done(t.finish.bind(t));
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

    makePipeline().setSchema(schema).getTreeP().then(function(tree) {
        traverse(schema, tree);
    }).done(t.finish.bind(t));
};

exports.testBundle = function(t, assert) {
    var reader = new ModuleReader(sourceDir);

    reader.readModuleP("home").then(function(homeModule) {
        return makeBundleP(homeModule);
    }).then(function(bundle) {
        var homeModule = bundle.get("home");
        var assertModule = bundle.get("assert");
        assert.ok(homeModule);
        assert.ok(assertModule);
        assert.strictEqual(homeModule.id, "home");
        assert.strictEqual(assertModule.id, "assert");
    }).done(t.finish.bind(t));
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

exports.testBundleWriter = function(t, assert) {
    var reader = new ModuleReader(sourceDir);
    var writer = new BundleWriter(outputDir);

    reader.setSteps(require("../steps/module/wrap"));
    writer.setSteps(require("../steps/bundle/loader"),
                    require("../steps/bundle/uglify"));

    fs.readdirSync(outputDir).forEach(function(file) {
        fs.unlinkSync(path.join(outputDir, file));
    });

    fs.rmdirSync(outputDir);
    fs.mkdirSync(outputDir);

    reader.readModuleP("home").then(function(home) {
        assert.strictEqual(home.id, "home");
        return writeAndCheckExistsP(writer, makeBundleP(home));
    }).then(function(exists) {
        assert.strictEqual(exists, true);
    }).done(t.finish.bind(t));
};

exports.testResolver = function(t, assert) {
    var reader = new ModuleReader(sourceDir);
    Q.all([
        reader.readModuleP("WidgetShare"),
        reader.readModuleP("widget/share")
    ]).spread(function(share1, share2) {
        assert.strictEqual(share1.id, "WidgetShare");
        assert.strictEqual(share2.id, "WidgetShare");
        assert.strictEqual(share1.source, share2.source);
        assert.strictEqual(share1.hash, share2.hash);
    }).done(t.finish.bind(t));
};
