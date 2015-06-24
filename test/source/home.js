require("myassert");
require("./myassert");
require("./tests/../myassert");

require("ignored-module");
require("react/addons"); // also ignored

require("recast"); // defined as dependency in package.json
require("recast/lib/types");
require("mocha"); // a dev dependency

require("fs"); // node built-in

exports.name = "home";
