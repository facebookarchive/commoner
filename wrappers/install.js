module.exports = function(id, source) {
    return "install(" + JSON.stringify(id) +
        ",function(require,exports,module){" +
        source + "});";
};
