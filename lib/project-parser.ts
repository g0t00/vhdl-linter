import { readFileSync, promises } from 'fs';
import { OEntity, OFileWithEntity, OPackage, OFileWithPackage } from './parser/objects';
import { VhdlLinter } from './vhdl-linter';
import { watch, FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { join, resolve } from 'path';

export class ProjectParser {

  public cachedFiles: OFileCache[] = [];
  private packages: OPackage[];
  private entities: OEntity[];
  events = new EventEmitter();
  constructor(public workspaces: string[]) { }
  async init() {
    let files = new Set<string>();
    await Promise.all(this.workspaces.map(async (directory) => {
      const directories = await this.parseDirectory(directory);
      return (await Promise.all(directories.map(file => promises.realpath(file)))).forEach(file => files.add(file));
    }));
    // for (const directory of this.workspaces) {
    //   this.parseDirectory(directory).forEach(file => files.add(realpathSync(file)));
    // }
    const pkg = __dirname;
    if (pkg) {
      //       console.log(pkg, new Directory(pkg + '/ieee2008'));
      (await this.parseDirectory(join(pkg, '/../../ieee2008'))).forEach(file => files.add(file));
      files.add(join(pkg, '/../../standard.vhdl'));
      files.add(join(pkg, '/../../textio.vhdl'));
    }
    for (const file of files) {
      let cachedFile = new OFileCache(file, this);
      this.cachedFiles.push(cachedFile);
    }
    this.fetchEntitesAndPackages();
    for (const workspace of this.workspaces) {
      const watcher = watch(workspace + '/**/*.vhd', { ignoreInitial: true });
      watcher.on('add', async (path) => {
        let cachedFile = new OFileCache(path, this);
        this.cachedFiles.push(cachedFile);
        this.fetchEntitesAndPackages();
        this.events.emit('change', 'add', path);
      });
      watcher.on('change', async (path) => {
        const cachedFile = this.cachedFiles.find(cachedFile => cachedFile.path === path);
        if (cachedFile) {
          cachedFile.reparse();
        } else {
          console.error('modified file not found', path);
        }
        this.fetchEntitesAndPackages();
        this.events.emit('change', 'change', path);
      });
      watcher.on('unlink', path => {
        const cachedFileIndex = this.cachedFiles.findIndex(cachedFile => cachedFile.path === path);
        this.cachedFiles.splice(cachedFileIndex, 1);
        this.fetchEntitesAndPackages();
        this.events.emit('change', 'unlink', path);
      });

    }
  }
  private async parseDirectory(directory: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await promises.readdir(directory);

    // const entries = await promisify(directory.getEntries)()
    await Promise.all(entries.map(async entry => {
      try {
        const fileStat = await promises.stat(directory + '/' + entry);
        if (fileStat.isFile()) {
          if (entry.match(/\.vhdl?$/i)) {
            files.push(directory + '/' + entry);
          }
        } else {
          files.push(... await this.parseDirectory(directory + '/' + entry));
        }
      } catch (e) {
        console.log(e);
      }
    }));
    return files;
  }
  private fetchEntitesAndPackages() {
    //     console.log(this.cachedFiles);
    this.packages = [];
    this.entities = [];
    for (const cachedFile of this.cachedFiles) {
      if (cachedFile.entity) {
        this.entities.push(cachedFile.entity);
      }
      if (cachedFile.package) {
        this.packages.push(cachedFile.package);
      }
    }
  }
  watcher: FSWatcher;
  addFolders(folders: string[]) {
    this.watcher.add(folders.map(folder => folder + '/**/*.vhd'));
  }
  public getPackages(): OPackage[] {
    return this.packages;
  }
  public getEntities(): OEntity[] {
    return this.entities;
  }
}

export class OFileCache {

  path: string;
  digest: string;
  package?: OPackage;
  entity?: OEntity;
  text: string;
  linter: VhdlLinter;
  constructor(file: string, public projectParser: ProjectParser) {
    const text = readFileSync(file, { encoding: 'utf8' });
    if (!text) {
      return;
    }
    this.text = text;
    // this.digest = await file.getDigest();
    this.path = file;
    this.linter = new VhdlLinter(this.path, this.text, this.projectParser);
    this.parsePackage();
    this.parseEntity();
  }
  reparse() {
    this.linter = new VhdlLinter(this.path, this.text, this.projectParser);
  }
  private parsePackage(): void {
    if ((this.linter.tree instanceof OFileWithPackage)) {
      this.package = this.linter.tree.package;
    }


  }
  private parseEntity(): void {
    if ((this.linter.tree instanceof OFileWithEntity)) {
      this.entity = this.linter.tree.entity;
    }
  }
}
// type t_packet is (p_NONE, p_CM_REQ, p_CM_REJ, p_CM_REP, p_CM_RTU, p_CM_DREQ, p_CM_DREP, p_RC_MR, p_RC_SIZE, p_RC_DECLINE, p_RDMA_F, p_RDMA_M, p_RDMA_L, p_RDMA_O, p_ACK);
