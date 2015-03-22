require("assert");
require("./assert");
require("./tests/../assert");

require("ignored-module");
require("react/addons"); // also ignored

require("recast"); // defined as dependency in package.json
require("recast/lib/types");

exports.name = "home";
