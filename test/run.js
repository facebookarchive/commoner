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

debugContext.setCacheDirectory(path.join(
    outputDir, ".debug-module-cache"));

releaseContext.setCacheDirectory(path.join(
    outputDir, ".release-module-cache"));

function getProvidedP(id) {
    var context = this;
    return context.getProvidedP().then(function(idToPath) {
        if (idToPath.hasOwnProperty(id))
            return context.readFileP(idToPath[id]);
    });
}

function getSourceP(id) {
    return this.readModuleP(id);
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

exports.testProvidesModule = function(t, assert) {
    var code = arguments.callee.toString();

    /**
     * Look, Ma! A test function that uses itself as input!
     * @providesModule
     * @providesModule foo/bar
     */

    assert.strictEqual(
        code.split("@provides" + "Module").length,
        4);

    assert.strictEqual(
        debugContext.getProvidedId(code),
        "foo/bar");

    assert.strictEqual(
        debugContext.getProvidedId(
            "no at-providesModule, here"),
        null);

    /**
     * Just to make sure we only pay attention to the first one.
     * @providesModule ignored
     */

    function helper(context) {
        var reader = new ModuleReader(context, [
            getProvidedP,
            getSourceP
        ], []);

        return Q.all([
            reader.readMultiP([
                "widget/share",
                "WidgetShare"
            ]).spread(function(ws1, ws2) {
                assert.strictEqual(ws1.id, ws2.id);
                assert.strictEqual(ws1.id, "WidgetShare");
                assert.strictEqual(ws1, ws2);
            }),

            Q.all([
                reader.getSourceP("widget/share"),
                reader.getSourceP("WidgetShare")
            ]).spread(function(source1, source2) {
                assert.strictEqual(source1, source2);
            })
        ]);
    }

    waitForHelpers(t, helper);
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
    var moduleId = "some/deeply/nested/module";
    var processor = require("../lib/relative").getProcessor(null);

    function makeSource(id) {
        var str = JSON.stringify(id);
        return "require(" + str + ");\n" +
            "require(function(){require(" + str + ")}())";
    }

    function helperP(requiredId, expected) {
        assert.strictEqual(
            util.relativize(moduleId, requiredId),
            expected);

        return processor(
            moduleId,
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

exports.testWriteFd = function(t, assert) {
    var file = path.join(outputDir, "writeFdP.test.txt");

    function check(content) {
        function afterUnlink(err) {
            return util.openExclusiveP(file).then(function(fd) {
                return util.writeFdP(fd, content).then(function(written) {
                    assert.strictEqual(content, written);
                });
            });
        }

        return function() {
            return util.unlinkP(file).then(afterUnlink, afterUnlink);
        };
    }

    Q.resolve("ignored")
        .then(check("x"))
        .then(check("x\ny"))
        .then(check("x\r\ny"))
        .then(check("\t\nx\t"))
        .then(check("\ufeff")) // zero-width non-breaking space
        .then(check("\u2603")) // snowman
        .then(check("\ud83d\udc19")) // octopus
        .fin(function() {
            return util.unlinkP(file);
        })
        .done(t.finish.bind(t));
};
