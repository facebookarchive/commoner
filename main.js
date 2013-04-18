var path = require("path");
var util = require("./lib/util");

var versionP = util.readJsonFileP(
    path.join(__dirname, "package.json")
).get("version");

var Commoner = require("./lib/commoner").Commoner;
exports.Commoner = Commoner;

function defCallback(name) {
    exports[name] = function() {
        var commoner = new Commoner;

        versionP.then(function(version) {
            commoner.cliBuildP(version);
        });

        return commoner[name].apply(commoner, arguments);
    };
}
defCallback("resolve");
defCallback("process");
