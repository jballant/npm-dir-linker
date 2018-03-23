npm-dir-linker
==============

If you are developing a node module that you want to test in another node project, this command line tool can be used to install that `node_module` from your local machine into your other project and then create watchers for all top-level files/directories that will copy any changes over to the installed package for testing changes.

Instead of just symlink-ing the entire repo directly into `node_modules` for your other project like `npm install`, this tool simply installs the directory from your local machine, and then will copy changed files/directories over in the event of a change. That way, you do not have to worry about module resolution conflicts between modules that your symlinked package uses and the copies installed in your other project.

NOTE: this package uses `npm pack` to install a local copy of your directory (a normal npm install would create a symlink), and as a result, you will see changes in your in the current projects `package.json` and `package-lock` to point to the installed tarball. Presumably, you might want to undo these changes when you are getting your project "production" ready. 

Currently designed for npm 5.x.x.

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
