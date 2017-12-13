npm-dir-linker
==============

If you are developing a node module that you want to test in another node project, this command line tool can be used to install that node_module from your local machine into your other project and then create watchers for all top-level files/directories that will copy any changes over to the installed package for testing changes.

Instead of just symlink-ing the entire repo directly into node_modules for your other project like `npm link`, this tool simply installs the directory from your local machine, and then will copy changed files/directories over in the event of a change. That way, you do not have to worry about module resolution conflicts between modules that your symlinked package uses and the copies installed in your other project.

Currently designed for npm 2.x.x.

Install
-------
```
npm install -g npm-dir-linker
```


Usage
-----
```
npm-dir-linker --module=test-module-name --dir=~~/path/to/testModule --useIgnoreFile
```
