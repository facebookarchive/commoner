Brigade
---
Brigade flexibly and efficiently bundles CommonJS modules for delivery to a web browser by

1. supporting a declarative syntax for organizing sets of modules,
2. using [promises](https://github.com/kriskowal/q) to manage an asynchronous bundling pipeline, and
3. never rebuilding modules or bundles that have already been built.

The output can be conveniently consumed not only by other node.js modules but also by external programs. Bundles produced by the build process are collected in a single directory that can be used by any static file server, or easily uploaded to a CDN for serving production traffic.

Installation
---
From NPM:

    npm install brigade

From GitHub:

    cd path/to/node_modules
    git clone git://github.com/benjamn/brigade.git
    cd brigade
    npm install .

Input
---

To use `brigade` you should first create a JSON file in the root directory of your CommonJS module tree. The name of the file is not important, so let's just pretend it's called `schema.json`. It should contain a nested object literal where all the keys are module identifier strings (which may or may not correspond to actual file paths):

    {
        "core": {
            "third-party": {
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
        },
        "widget/common": {
            "widget/follow": {},
            "widget/gallery": {},
            "widget/share": {}
        },
        "widget/share": {}
    }

This object expresses a *tree* of possible bundle sequences. A bundle is simply a set of CommonJS modules, so, as you might imagine, a "bundle sequence" is an ordered list of sets of modules.

Given the example tree above, you might have a /settings page that uses the following sequence of bundles:

1. `core`            (+ any dependencies and a small module loader)
2. `third-party`     (+ dependencies not in core)
3. `settings`        (+ dependencies not in core or third-party)
4. `tests/settings`  (+ dependencies not in core, third-party, or settings)

There is no overlap between the modules in a given sequence of bundles, since any given module can appear at most once in at most one bundle in the sequence.

Each bundle in the sequence corresponds to a separate JavaScript file. The first bundle (here, "core" plus its dependencies) must be evaluated first, as it contains a small amount of boilerplate code for loading modules. The rest of the bundles ought to be evaluated in order, too, although any suffix of the sequence can be dropped. For instance, you could omit "tests/settings" in production.

Since two examples are much better than one, you might also have a sharing widget that requires only two bundles:

1. `widget/common`
2. `widget/share`

The separation is useful if "widget/common" is relatively unchanging and you want it to be cached separately. Alternatively, you might value the simplicity of having only one JS file to include, in which case you could promote "widget/share" to the top level of the schema, in order to bundle it (and all of its dependencies) into one monolithic file.

This tradeoff demonstrates the path-dependency of bundles: including "widget/share" after "widget/common" is potentially different from just including "widget/share", so the actual JS file names corresponding to these two versions of "widget/share" may differ.

Output
---

Now that you have a schema file, all that's left is to point the `bin/brigade` command at it:

    bin/brigade --schema path/to/schema.json --output-dir path/to/output/dir

This command will populate `path/to/output/dir` with JS bundle files whose names are hashes computed from the source files they contain, and any transformation steps that were applied. Because the hash is a pure function of the input, the command can avoid rebuilding bundles that have already been built.

When the build process finishes, the `bin/brigade` command prints a tree of JSON to STDOUT. For example:

    { "core": {
        "file": "61a2d165baf797cefeb374a010ad3d15ffa73a09.js",
        "then": {
          "third-party": {
            "file": "3c8bcc25cdf32024868707259892abcdd89f0dcc.js",
            "then": {
              "login": {
                "file": "f3b9440dfe8a5bc1796792ce736478ac0afc74d5.js",
                "then": {
                  "tests/login": {
                    "file": "76bfa5a904beec3d69a3f942d7e534bfaaad8b4d.js" }}},
              "home": {
                "file": "687016a47bd21ccf520418d25f954a7807b161ab.js",
                "then": {
                  "tests/home": {
                    "file": "925557fc996df73a4aac46266ba7c3fb90b0c530.js" }}},
              "settings": {
                "file": "9203cfa9f05aa7355a8b9779229b70c580881c94.js",
                "then": {
                  "tests/settings": {
                    "file": "e77654d2f995cde56c3c1859fa967e3471b0f122.js" }}}}}}},
      "widget/common": {
        "file": "6bcb66751c26c485978a06a4d23f3fcb8655eb04.js",
        "then": {
          "widget/follow": {
            "file": "baedf19657edde944e32f8273e5ac7bc9f887fe5.js" },
          "widget/gallery": {
            "file": "192bbd2125958aa5c58c1d5aca72484d339558f8.js" },
          "widget/share": {
            "file": "bd24e1167130b09c29db212ffd31d73e0f03987e.js" }}},
      "widget/share": {
        "file": "8627eba2e11991cc42ba30352c6f81032b3d9e2d.js" }}

Although this may look like a wall of text, it has a very regular structure that is easy to manipulate with code. The value associated with each key of the schema has been replaced with an object literal that has a "file" property and, if the bundle has any descendants, a "then" property that refers to its child properties.

If you were to parse this JSON and store the resulting object in a variable called `tree`, you could refer to the `settings` bundle from the first example as `tree.core.then["third-party"].then.settings.file`.

Likewise, you could refer to "widget/share" in two different ways:

- `tree["widget/common"].then["widget/share"].file` or
- `tree["widget/share"].file`

If you run the `bin/bridgade` command again without changing anything, the output will be the same, but the command will run much more quickly, because it notices when a file with a specific name already exists.

Customization
---
The `bin/brigade` script is actually quite simple, and you can write similar scripts yourself. Let's have a look:

    #!/usr/bin/env node

    require("brigade").source(function(id) {
        var context = this;
        return context.getProvidedP().then(function(idToPath) {
            if (idToPath.hasOwnProperty(id))
                return context.readFileP(idToPath[id]);
        });
    }, function(id) {
        return this.readFileP(id + ".js");
    });

The scriptable interface of the `brigade` module abstracts away many of the annoyances of writing a command-line script. In particular, you don't have to do any parsing of command-line arguments, and you don't have to worry about installing any dependencies other than `brigade` in your `$NODE_PATH`.

What you are responsible for, at a minimum, is telling Brigade how to find the source of a module given a module identifier, and you do this by passing callback functions to `require("brigade").source`. The script above uses two strategies that will be tried in sequence: first, it calls the helper function `this.getProvidedP` to retrieve an object mapping identifiers to file paths (more about this below); and, if that doesn't work, it falls back to interpreting the identifier as a path relative to the source directory.

Now, you might not care about `this.getProvidedP`. It's really just a proof of concept that Brigade can support modules that declare their own identifiers using the `// @providesModule <identifier>` syntax, and I included it by default because it doesn't make a difference unless you decide to use `@providesModule`. If you don't like it, you could write an even simpler script:

    #!/usr/bin/env node

    require("brigade").source(function(id) {
        return this.readFileP(id + ".js");
    });

The point is, it's entirely up to you to define how module identifiers are interpreted. In fact, the source you return doesn't even have to be valid JavaScript. It could be [CoffeeScript](http://coffeescript.org/), or [LESS](http://lesscss.org/), or whatever language you prefer to write by hand. Brigade doesn't care what your source code looks like, because Brigade allows you to define arbitrary build steps to turn that source code into plain old CommonJS.

Let's consider the example of using LESS to write dynamic CSS modules. First, let's apply what we already know to give special meaning to `.less` files:

    #!/usr/bin/env node

    require("brigade").source(function(id) {
        if (isLess(id))
            return this.readFileP(id);
    }, function(id) {
        return this.readFileP(id + ".js");
    });

    function isLess(id) {
        return /\.less$/i.test(id);
    }

All this accomplishes is to avoid appending the `.js` file extension to identifiers that already have the `.less` extension.

Now we need to make sure the contents of `.less` files somehow get transformed into plain old CommonJS, and for that we need `require("brigade").module`:

    require("brigade").source(function(id) {
        if (isLess(id))
            return this.readFileP(id);
    }, function(id) {
        return this.readFileP(id + ".js");
    }).module(function(id, source) {
        if (isLess(id))
            return compileLessToJs(source);
        return source;
    });

How should `compileLessToJs` be implemented? At a high level, I propose that we generate a CommonJS module that will append a new `<style>` tag to the `<head>` the first time the module is required. This suggests to me that we need to take the CSS generated by LESS and somehow embed it as a string in a CommonJS module with a small amount of boilerplate JS.

Here's a first attempt:

    function compileLessToJs(less) {
        var css = require("less").render(less);
        return 'require("css").add(' + JSON.stringify(css) + ");";
    }

Implementing a `css` module with an appropriate `add` method is an exercise that I will leave to the reader (hint: you may find [this StackOverflow answer](http://stackoverflow.com/a/524721/128454) useful).

This almost works, but there's one problem: `require("less").render` does not actually return a string! For better or worse, it passes the compiled CSS to a callback function, which would make our task extremely painful *if Brigade were not deeply committed to supporting asynchronous processing*.

Brigade uses promises for asynchronous control flow, so we need to return a promise if we can't return a string immediately. The easiest way to make a promise is to call `this.makePromise` in the following style:

    #!/usr/bin/env node

    require("brigade").source(function(id) {
        if (isLess(id))
            return this.readFileP(id);
    }, function(id) {
        return this.readFileP(id + ".js");
    }).module(function(id, source) {
        if (isLess(id))
            return this.makePromise(function(nodeStyleCallback) {
                compileLessToJs(source, nodeStyleCallback);
            });
        return source;
    });

    function compileLessToJs(less, callback) {
        require("less").render(less, function(err, css) {
            callback(err, 'require("css").add(' + JSON.stringify(css) + ");")
        });
    }

And we're done! This example was admittedly pretty involved, but if you followed it to the end you now know everything you need know to write source files like `sidebar.less` and require them from other modules by invoking `require("sidebar.less")`. (By the way, embedding dynamic CSS modules in your JavaScript turns out to be an excellent idea.)

So far we've seen the all-important `require("brigade").source` method and the also-fairly-nifty `require("brigade").module` method, but there is one more method that you might be interested in: `require("brigade").bundle`. Much like `.module`, `.bundle` transforms your source code before Brigade generates the final bundle files. The difference is that bundle transformations occur after transformed modules have been concatenated together. It's a great way to perform sweeping modifications that don't depend on individual modules, like replacing a symbolic constant with a literal value, dead code elimination, or minification.

Actually, minification is such a common need that Brigade will just do it for you if you pass a JSON file containing the property `"debug": false` to the `--config` command-line option:

    bin/brigade --schema path/to/schema.json --output-dir path/to/output/dir --config release.json

or even:

    echo '{"debug":false}' | bin/brigade \
        --schema path/to/schema.json \
        --output-dir path/to/output/dir \
        --config /dev/stdin

Inside `.source`, `.module`, and `.bundle` callbacks, the config object is accessible as `this.config`. Also note that the config object is recursively hashed, so that bundles generated from one config object will be distinct from bundles generated using a different configuration.

Just for illustration purposes, if you had to implement minification yourself, you might do it like this:

    require("brigade").source(function(id) {
        return this.readFileP(id + ".js");
    }).bundle(function(bundle, source) {
        if (this.config.debug)
            return source;
        return minify(source);
    });

Because the most common `.bundle` use case is already taken care of, you might not ever have to use the `.bundle` method. It's generally better to apply a transformation at the module level if you can, because then it only needs to be reapplied to modules that have changed, rather than being applied every time any module in a bundle changes.

[Drop me a note](https://github.com/benjamn/brigade/issues/15) if you come up with any compelling use cases for `.bundle`, because I'm already tempted to deprecate it if no one actually wants it.
