module.exports = function(id, source) {
    return "define(" + JSON.stringify(id) +
        ",function(require,exports,module){" +
        source + "});";
};
