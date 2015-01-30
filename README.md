npm-dir-linker
==============

If you are developing a node module that you want to test in another node project, this command line tool can be used to install that node_module from your local machine into your other project and then symlink all top-level files/directories.

Instead of just symlinking the entire repo directly into node_modules for your other project, this tool respects top level files/folders in .gitignore, as well as "node_modules". That way, the "installation" looks more like a regular "npm-install" would.

Install
-------
```
npm install -g npm-dir-linker
```


Usage
-----
```
npm-dir-linker --module=testModule --dir=/path/to/testModule
```
