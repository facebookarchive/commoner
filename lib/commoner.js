var assert = require("assert");
var path = require("path");
var fs = require("fs");
var Q = require("q");
var Watcher = require("./watcher").Watcher;
var contextModule = require("./context");
var BuildContext = contextModule.BuildContext;
var PreferredFileExtension = contextModule.PreferredFileExtension;
var ModuleReader = require("./reader").ModuleReader;
var output = require("./output");
var DirOutput = output.DirOutput;
var StdOutput = output.StdOutput;
var util = require("./util");
var log = util.log;
var Ap = Array.prototype;
var each = Ap.forEach;

function Commoner() {
    var self = this;
    assert.ok(self instanceof Commoner);

    Object.defineProperties(self, {
        resolvers: { value: [] },
        processors: { value: [] }
    });
}

var Cp = Commoner.prototype;

// A resolver is a function that takes a module identifier and returns
// the unmodified source of the corresponding module, either as a string
// or as a promise for a string.
Cp.resolve = function() {
    each.call(arguments, function(resolver) {
        assert.strictEqual(typeof resolver, "function");
        this.resolvers.push(resolver);
    }, this);

    return this; // For chaining.
};

// A processor is a function that takes a module identifier and a string
// representing the source of the module and returns a modified version of
// the source, either as a string or as a promise for a string.
Cp.process = function(processor) {
    each.call(arguments, function(processor) {
        assert.strictEqual(typeof processor, "function");
        this.processors.push(processor);
    }, this);

    return this; // For chaining.
};

// This default can be overridden by individual Commoner instances.
Object.defineProperty(Cp, "persistent", { value: false });

Cp.buildP = function(config, sourceDir, outputDir, roots) {
    var self = this;
    var watcher = new Watcher(sourceDir, self.persistent);
    var waiting = 0;
    var output = outputDir
        ? new DirOutput(outputDir)
        : new StdOutput;

    watcher.on("changed", function(file) {
        if (self.persistent) {
            log.err(file + " changed; rebuilding...", "yellow");
            rebuild();
        }
    });

    function outputModules(modules) {
        // Note that output.outputModules comes pre-bound.
        modules.forEach(output.outputModule);
        return modules;
    }

    function finish(result) {
        rebuild.ing = false;

        if (waiting > 0) {
            waiting = 0;
            process.nextTick(rebuild);
        }

        return result;
    }

    function rebuild() {
        if (rebuild.ing) {
            waiting += 1;
            return;
        }

        rebuild.ing = true;

        var context = new BuildContext(config, watcher);

        if (self.preferredFileExtension)
            context.setPreferredFileExtension(
                self.preferredFileExtension);

        if (self.cacheDir)
            context.setCacheDirectory(self.cacheDir);

        context.setIgnoreDependencies(self.ignoreDependencies);

        return new ModuleReader(
            context,
            self.resolvers,
            self.processors
        ).readMultiP(context.expandIdsOrGlobsP(roots))
            .then(context.ignoreDependencies ? pass : collectDepsP)
            .then(outputModules)
            .then(outputDir ? printModuleIds : pass)
            .then(finish, function(err) {
                log.err(err.stack);
                finish();
            });
    }

    return lockOutputDirP(outputDir).then(rebuild);
};

function pass(modules) {
    return modules;
}

function collectDepsP(rootModules) {
    var modules = [];
    var seenIds = {};

    function traverse(module) {
        if (seenIds.hasOwnProperty(module.id))
            return Q.resolve(modules);
        seenIds[module.id] = true;

        return module.getRequiredP().then(function(reqs) {
            return Q.all(reqs.map(traverse));
        }).then(function() {
            modules.push(module);
            return modules;
        });
    }

    return Q.all(rootModules.map(traverse)).then(
        function() { return modules });
}

function printModuleIds(modules) {
    log.out(JSON.stringify(modules.map(function(module) {
        return module.id;
    })));

    return modules;
}

function lockOutputDirP(outputDir) {
    if (!outputDir) {
        // If outputDir is falsy, then there's nothing to lock.
        return Q.resolve(outputDir);
    }

    return util.mkdirP(outputDir).then(function(dir) {
        var lockFile = path.join(outputDir, ".lock.pid");
        return util.acquireLockFileP(lockFile).then(function() {
            return dir;
        }, function(err) {
            throw new Error("output directory " + outputDir + " currently in use");
        });
    });
}

Cp.forceResolve = function(forceId, source) {
    this.resolvers.unshift(function(id) {
        if (id === forceId)
            return source;
    });
};

Cp.cliBuildP = function(version) {
    var commoner = this;
    var options = require("commander");
    var workingDir = process.cwd();
    var sourceDir = workingDir;
    var outputDir = null;
    var roots;

    options.version(version)
        .usage("[options] <source directory> <output directory> [<module ID> [<module ID> ...]]")
        .option("-c, --config [file]", "JSON configuration file (no file means STDIN)")
        .option("-w, --watch", "Continually rebuild")
        .option("-x, --extension <js | coffee | ...>",
                "File extension to assume when resolving module identifiers")
        .option("--cache-dir <directory>", "Alternate directory to use for disk cache")
        .parse(process.argv.slice(0));

    var pfe = new PreferredFileExtension(options.extension || "js");

    // TODO Decide whether passing options to buildP via instance
    // variables is preferable to passing them as arguments.
    this.preferredFileExtension = pfe;
    this.persistent = options.watch;
    this.cacheDir = absolutePath(workingDir, options.cacheDir);
    this.ignoreDependencies = false;

    function fileToId(file) {
        file = absolutePath(workingDir, file);
        assert.ok(fs.statSync(file).isFile(), file);
        return pfe.trim(path.relative(sourceDir, file));
    }

    var args = options.args.slice(0);
    var argc = args.length;
    if (argc === 0) {
        if (options.config === true) {
            log.err("Cannot read --config from STDIN when reading " +
                    "source from STDIN");
            process.exit(-1);
        }

        sourceDir = workingDir;
        outputDir = null;
        roots = ["<stdin>"];
        commoner.forceResolve("<stdin>", util.readFromStdinP());

        // Ignore dependencies because we wouldn't know how to find them.
        this.ignoreDependencies = true;

    } else {
        var first = absolutePath(workingDir, args[0]);
        var stats = fs.statSync(first);

        if (argc === 1) {
            var firstId = fileToId(first);
            sourceDir = workingDir;
            outputDir = null;
            roots = [firstId];
            commoner.forceResolve(firstId, util.readFileP(first));

            // Ignore dependencies because we wouldn't know how to find them.
            this.ignoreDependencies = true;

        } else if (stats.isDirectory(first)) {
            sourceDir = first;
            outputDir = absolutePath(workingDir, args[1]);
            roots = args.slice(2);
            if (roots.length === 0)
                roots.push(this.preferredFileExtension.glob());

        } else {
            options.help();
            process.exit(-1);
        }
    }

    return Q.all([
        getConfigP(workingDir, options.config),
        sourceDir,
        outputDir,
        roots
    ]).spread(commoner.buildP.bind(commoner));
};

function absolutePath(workingDir, pathToJoin) {
    if (pathToJoin) {
        workingDir = path.normalize(workingDir);
        pathToJoin = path.normalize(pathToJoin);
        if (pathToJoin.charAt(0) !== "/")
            pathToJoin = path.join(workingDir, pathToJoin);
    }
    return pathToJoin;
}

function getConfigP(workingDir, configFile) {
    if (typeof configFile === "undefined")
        return {}; // Empty config.

    var stdin = "/dev/stdin";
    if (configFile === true) {
        // When --config is present but has no argument, default to STDIN.
        configFile = stdin;
    }

    configFile = absolutePath(workingDir, configFile);

    if (configFile === stdin) {
        log.err(
            "Expecting configuration from STDIN (pass --config <file> " +
            "if stuck here)...",
            "yellow");
        return util.readJsonFromStdinP();
    }

    return util.readJsonFileP(configFile);
}

exports.Commoner = Commoner;
