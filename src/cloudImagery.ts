import { Credit, UrlTemplateImageryProvider, type ImageryLayer, type Viewer } from "cesium";
import { beginWork } from "./pendingWork.ts";

export interface CloudImageState {
  source: "ssec" | "nasa" | null;
  time: number | null;
  sensors: string[];
  loading: boolean;
  error: boolean;
}
interface Group {
  key: string;
  source: "ssec" | "nasa";
  time: number | null;
  sensors: string[];
  layers: ImageryLayer[];
  listeners: (() => void)[];
  failed: () => void;
}

/** Stage a complete source, then atomically replace the previously shown source. */
export class CloudImagery {
  private shown: Group | null = null;
  private candidate: Group | null = null;
  private cancelLoad: (() => void) | null = null;
  private disposed = false;
  private opacity = 65;
  private state: CloudImageState = { source: null, time: null, sensors: [], loading: false, error: false };
  private viewer: Viewer;
  private notify: (state: CloudImageState) => void;
  constructor(viewer: Viewer, notify: (state: CloudImageState) => void) {this.viewer=viewer;this.notify=notify;}

  private publish(loading: boolean, error: boolean) {
    this.state = {source:this.shown?.source ?? null,time:this.shown?.time ?? null,sensors:this.shown?.sensors ?? [],loading,error};
    this.notify(this.state);
  }
  private drop(group: Group | null) {
    if (!group) return;
    group.listeners.forEach(remove=>remove());
    if (!this.viewer.isDestroyed()) group.layers.forEach(layer=>this.viewer.imageryLayers.remove(layer,true));
  }
  private alpha(group: Group, pending: boolean) {
    const target=this.opacity/100 * (group.source === "nasa" ? 0.75 : 1);
    group.layers.forEach(layer=>{layer.alpha=pending ? Math.min(target,0.001) : target;});
  }
  setOpacity(opacity: number) {
    this.opacity=opacity;
    if(this.shown) this.alpha(this.shown,false);
    if(this.candidate) this.alpha(this.candidate,Boolean(this.shown));
    if(!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }
  hasSource(source: "ssec" | "nasa") { return this.shown?.source === source; }
  isCurrent(key: string) { return this.shown?.key === key || this.candidate?.key === key; }
  setLoading() { this.publish(true,false); }
  setError() { this.publish(false,true); }

  load(options: {key:string;source:"ssec"|"nasa";time:number|null;sensors:string[];tiles:{url:string;credit:string}[];maximumLevel:number}, failed:()=>void) {
    if(this.disposed) return;
    const matching=this.candidate?.key===options.key?this.candidate:this.shown?.key===options.key?this.shown:null;
    if(matching) {matching.failed=failed;return;}
    this.cancelLoad?.();
    const group: Group={...options,layers:[],listeners:[],failed};
    this.candidate=group;
    const done=beginWork();
    let waiting=true, stable=0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeRender=()=>{};
    const stopWaiting=()=>{waiting=false;clearTimeout(timer);removeRender();done();};
    const cancel=()=>{stopWaiting();if(this.candidate===group)this.candidate=null;this.drop(group);};
    this.cancelLoad=cancel;
    const fail=()=>{
      if(this.disposed || (this.candidate!==group && this.shown!==group)) return;
      stopWaiting();
      if(this.candidate===group) {this.candidate=null;this.cancelLoad=null;}
      if(this.shown===group) this.shown=null;
      this.drop(group);this.publish(false,this.shown?.source!=="nasa");this.viewer.scene.requestRender();group.failed();
    };
    for(const tile of options.tiles) {
      const provider=new UrlTemplateImageryProvider({url:tile.url,maximumLevel:options.maximumLevel,credit:new Credit(tile.credit)});
      group.listeners.push(provider.errorEvent.addEventListener(fail));
      const layer=this.viewer.imageryLayers.addImageryProvider(provider);
      if(options.source==="ssec") {layer.contrast=1.12;layer.gamma=0.95;}
      group.layers.push(layer);
    }
    this.alpha(group,Boolean(this.shown));this.publish(true,false);
    timer=setTimeout(fail,60_000);
    removeRender=this.viewer.scene.postRender.addEventListener(()=>{
      if(!waiting || this.disposed) return;
      stable=this.viewer.scene.globe.tilesLoaded ? stable+1 : 0;
      if(stable<2) {this.viewer.scene.requestRender();return;}
      stopWaiting();this.cancelLoad=null;
      const previous=this.shown;
      this.shown=group;this.candidate=null;
      this.alpha(group,false);this.drop(previous);
      this.publish(false,false);this.viewer.scene.requestRender();
    });
    this.viewer.scene.requestRender();
  }
  clear() {
    this.cancelLoad?.();this.cancelLoad=null;
    this.drop(this.shown);this.shown=null;this.candidate=null;
    this.publish(false,false);
    if(!this.viewer.isDestroyed())this.viewer.scene.requestRender();
  }
  dispose() {this.clear();this.disposed=true;}
}
