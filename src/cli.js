/*eslint-env node */
/*eslint no-process-exit: 0 */
'use strict';

var Deferred = require('bluebird');
var chalk = require('chalk');
var program = require('commander');
var readFile = Deferred.promisify(require('fs').readFile);
var glob = Deferred.promisify(require('glob'));
var bootlint = require('./bootlint');

module.exports = function () {
    program
        .version(require('../package.json').version)
        .description('Lint the HTML of Bootstrap projects')
        .usage('[options] [files...]')
        .option('-d, --disable <IDs>', 'Comma-separated list of disabled lint problem IDs', function (val) {
            return val.split(',');
        })
        .parse(process.argv);

    var disabledIds = program.disable === undefined ? [] : program.disable;
    var totalErrCount = 0;
    var totalFileCount = 0;
    var lintedFiles = [];

    function buildReporter(origin) {
        return function (lint) {
            var lintId = (lint.id[0] === 'E') ? chalk.bgGreen.white(lint.id) : chalk.bgRed.white(lint.id);
            var output = false;
            if (lint.elements) {
                lint.elements.each(function (_, element) {
                    var loc = element.startLocation;
                    console.log(origin + ":" + (loc.line + 1) + ":" + (loc.column + 1), lintId, lint.message);
                    totalErrCount++;
                    output = true;
                });
            }
            if (!output) {
                console.log(origin + ":", lintId, lint.message);
                totalErrCount++;
            }
        };
    }
    
    function IsJsonString(str) {
        try {
            JSON.parse(str);
        } catch (e) {
            return false;
        }
        return true;
    }
    
    function arrayUnique(array) {
        var a = array.concat();
        for(var i=0; i<a.length; ++i) {
            for(var j=i+1; j<a.length; ++j) {
                if(a[i] === a[j])
                    a.splice(j--, 1);
            }
        }
        return a;
    }

    function handleStdin() {
        return new Deferred(function (resolve) {
            if (process.stdin.isTTY) {
                return resolve();
            }

            var stdInput = [];

            process.stdin.setEncoding('utf8');

            process.stdin.on('data', function (chunk) {
                stdInput.push(chunk);
            });

            process.stdin.on('end', function () {
                bootlint.lintHtml(stdInput.join(''), buildReporter('<stdin>'), disabledIds);
                totalFileCount++;
                resolve();
            });
        });
    }

    function handlePath(pattern, relax) {
        var relaxIds = Array.isArray(relax) 
            ? arrayUnique(disableIds.concat(relax)) 
            : disabledIds;
        return glob(pattern)
            .map(function (name) {
                return Deferred.props({
                    contents: readFile(name, {encoding: 'utf8'}),
                    name: name
                });
            })
            .each(function (file) {
                bootlint.lintHtml(file.contents, buildReporter(file.name), relaxIds);
                totalFileCount++;
                return Deferred.resolve();
            });
    }

    if (!program.args.length) {
        program.args.push('-');
    }

    program.args.forEach(function (pattern) {
        var objPattern = IsJsonString(pattern) ? JSON.parse(pattern) : null;
        lintedFiles.push(pattern === '-'
            ? handleStdin() 
            : objPattern && objPattern.pattern && typeof objPattern.pattern == "string"
                ? handlePath(objPattern.pattern, Array.isArray(objPattern.relax) ? objPattern.relax : [])
                : handlePath(pattern)
        );
    });

    Deferred.all(lintedFiles).then(function () {
        console.log("");

        if (totalErrCount > 0) {
            console.log("For details, look up the lint problem IDs in the Bootlint wiki: https://github.com/twbs/bootlint/wiki");
        }

        console.log("" + totalErrCount + " lint error(s) found across " + totalFileCount + " file(s).");

        if (totalErrCount) {
            process.exit(1);
        }
    }, function (err) {
        console.error(err.stack);
    });
};
