npm-dir-linker
==============

If you are developing a node module that you want to test in another node project, this command line tool can be used to install that `node_module` from your local machine into your other project and then create watchers for all top-level files/directories that will copy any changes over to the installed package for testing changes.

Instead of just symlink-ing the entire repo directly into `node_modules` for your other project like `npm install`, this tool simply installs the directory from your local machine, and then will copy changed files/directories over in the event of a change. That way, you do not have to worry about module resolution conflicts between modules that your symlinked package uses and the copies installed in your other project.

NOTE: this package uses `npm pack` to install a local copy of your directory (a normal npm install would create a symlink), and as a result, you will see changes in your in the current projects `package.json` and `package-lock` to point to the installed tarball. Presumably, you might want to undo these changes when you are getting your project "production" ready. 

Currently designed for npm `6.x.x` (for npm `5.x.x` use version `0.2.0`).

Why?
----

If you are developing an npm package that is intended to be used in a "main project", it is common to simply install a local "dev" copy of the repo. Using `npm install` to install a local repository as a `node_module` into your project will mean that you get a symlink rather than a copy of the source files with shared dependencies omitted. As an example, if your project depends on module "A" and module "B", and they both depend on module "C", and if you  `npm install` a local copy of module "A" from another location on your machine, then "A" will be using the original repo's copy of module "C" while module "B" uses the project's hoisted copy of the shared "C" dependency.

This means that when you test the project locally, you are using different copies of module "C" and when you run the project in production, you are using a shared copy of "C".

So, in production, your directory structure looks like this
```
My Project
 node_modules
  - A
  - B
  - C
```

And your local development version looks like this:
```
My Project
 node_modules
  - A -> /local/path/to/A
  	 node_modules
  	 - C
  - B
  - C
```

That may be fine if your modules are stateless. However, not all modules are stateless--especially when considering `peerDependencies`. Let's say that module "C" has a static counter that increases every time it's invoked. If you use `npm install` to symlink to the "A" repository locally, it will have its own copy of "C" which means that you now are using two different static counters that will have different values then they would if this project were running in production using a single copy of "C". That kind of discrepancy with the production environment could cause serious bugs.

For these kind of situations, you can use `npm-dir-linker` to install the directory as if it was in an npm registry, and then it copy files over when they change (while `npm-dir-linker` is running). This makes development environments for npm projects better reflect how they would be run in production.

Install
-------
```
npm install -g npm-dir-linker
```


Usage
-----
```
npm-dir-linker --dir=~~/path/to/testModule --useIgnoreFile
```
