var assert = require("assert");
var Q = require("q");
var createHash = require("crypto").createHash;

function Bundle(modules, parent) {
    var self = this;

    assert.ok(self instanceof Bundle);
    assert.ok(!parent || (parent instanceof Bundle));
    assert.ok(modules.length > 0, "empty bundle?");

    var ids = {};
    var hash = createHash("sha1").update("bundle\0");

    if (parent) {
        hash.update("has-parent\0");
    }

    var repr = "Bundle(" + modules.map(function(module) {
        hash.update(module.hash);
        ids[module.id] = module;
        return JSON.stringify(module.id);
    }).join(", ") + ")";

    Object.defineProperties(self, {
        parent: { value: parent },
        hash: { value: hash.digest("hex") },
        repr: { value: repr },

        get: { value: function(id) {
            if (ids.hasOwnProperty(id))
                return ids[id];

            if (parent)
                return parent.get(id);
        }},

        getSource: { value: function() {
            return modules.map(function(module) {
                return module.source;
            }).join("\n");
        }}
    });
}

Bundle.prototype = {
    toString: function() {
        return this.repr;
    }
};

function makeBundleP(rootModule, parent) {
    var modules = [];
    var seen = {};

    function traverse(module) {
        if (seen[module.id] === true || (parent && parent.get(module.id)))
            return Q.resolve(modules);
        seen[module.id] = true;

        return module.getRequiredP().then(function(reqs) {
            return Q.all(reqs.map(traverse));
        }).then(function() {
            modules.push(module);
            return modules;
        });
    }

    return traverse(rootModule).then(function(modules) {
        return new Bundle(modules, parent);
    });
}

exports.makeBundleP = function(rootModuleP, parentP) {
    return Q.all([rootModuleP, parentP]).spread(makeBundleP);
};
