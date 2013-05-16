var Watcher = require("../lib/watcher").Watcher;
var BuildContext = require("../lib/context").BuildContext;
var ModuleReader = require("../lib/reader").ModuleReader;
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
        assert.strictEqual(home.source.indexOf('require("./assert");'), 0);
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

exports.testGrepP = function(t, assert) {
    Q.all([
        watcher.grepP("@providesModule\\s+\\S+"),
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

exports.testRelativize = function(t, assert) {
    var relativizeP = require("../lib/relative").relativizeP;

    function makeSource(id) {
        var str = JSON.stringify(id);
        return "require(" + str + ");\n" +
            "require(function(){require(" + str + ")}())";
    }

    function helperP(requiredId, expected) {
        return relativizeP(
            "some/deeply/nested/module",
            makeSource(requiredId)
        ).then(function(source) {
            assert.strictEqual(source, makeSource(expected));
        });
    }

    Q.all([
        helperP("another/nested/module",
                "../../../another/nested/module"),
        helperP("../../buried/module/./file",
                "../../buried/module/file"),
        helperP("../../buried/module/../file",
                "../../buried/file"),
        helperP("./same/level",
                "./same/level"),
        helperP("./same/./level",
                "./same/level"),
        helperP("./same/../level",
                "./level"),
        helperP("some/deeply/buried/treasure",
                "../buried/treasure"),
        helperP("./file", "./file"),
        helperP("./file/../../../module",
                "../../module"),
        helperP("./file/../../module",
                "../module")
    ]).done(t.finish.bind(t));
};

exports.testFlatten = function(t, assert) {
    function check(input, expected) {
        var flat = util.flatten(input);
        assert.deepEqual(flat, expected);
    }

    check(1, 1);
    check([[],,[],1, 2], [1, 2]);
    check([[[[[[]]]]]], []);
    check([[1,[[[[2]]],3]]], [1, 2, 3]);
    check([[1],[[2]],[[[3]]]], [1, 2, 3]);
    check([,,,], []);

    t.finish();
};
