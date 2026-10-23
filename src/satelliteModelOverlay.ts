import { Cartesian3, ConstantProperty, Matrix3, Matrix4, Model, type Entity, type Viewer } from "cesium";
import { SATELLITE_MODELS, modelInRange, type SatelliteModelStatus } from "./satelliteModels.ts";
import { beginWork } from "./pendingWork.ts";

/** One close-up model at a time; large-distance markers never download model assets. */
export class SatelliteModelOverlay {
  private viewer: Viewer;
  private notify: (status:SatelliteModelStatus)=>void;
  private target: {id:string;marker:Entity}|null=null;
  private model: Model|null=null;
  private position: Cartesian3|null=null;
  private matrix=new Matrix4();
  private status: SatelliteModelStatus="unavailable";
  private generation=0;
  private loading=false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private failed=false;
  private disposed=false;
  private finish:(()=>void)|null=null;
  private removeRender:()=>void;
  constructor(viewer:Viewer,notify:(status:SatelliteModelStatus)=>void) {
    this.viewer=viewer;this.notify=notify;
    this.removeRender=viewer.scene.preRender.addEventListener(()=>this.refresh());
  }
  private report(status:SatelliteModelStatus){if(this.status!==status){this.status=status;this.notify(status);}}
  private restoreMarker(){if(this.target?.marker.billboard)this.target.marker.billboard.show=new ConstantProperty(true);}
  private release(){
    clearTimeout(this.timeout);this.timeout=undefined;
    this.generation++;this.loading=false;this.finish?.();this.finish=null;
    this.restoreMarker();
    if(this.model && !this.viewer.isDestroyed())this.viewer.scene.primitives.remove(this.model);
    this.model=null;
  }
  setTarget(id:string|null,marker?:Entity){
    if(this.target?.id===id)return;
    this.release();this.position=null;this.failed=false;
    this.target=id && marker?{id,marker}:null;
    this.report(this.target && SATELLITE_MODELS[this.target.id]?"far":"unavailable");
  }
  retry(){this.failed=false;this.refresh();}
  update(position:Cartesian3|undefined,ahead?:Cartesian3){
    this.position=position?Cartesian3.clone(position):null;
    if(position && ahead){
      const z=Cartesian3.normalize(position,new Cartesian3());
      const v=Cartesian3.subtract(ahead,position,new Cartesian3());
      const tangent=Cartesian3.subtract(v,Cartesian3.multiplyByScalar(z,Cartesian3.dot(v,z),new Cartesian3()),new Cartesian3());
      if(Cartesian3.magnitudeSquared(tangent)>1e-12){
        const x=Cartesian3.normalize(tangent,tangent),y=Cartesian3.cross(z,x,new Cartesian3());
        const rotation=new Matrix3(x.x,y.x,z.x,x.y,y.y,z.y,x.z,y.z,z.z);
        Matrix4.fromRotationTranslation(rotation,position,this.matrix);
      }
    }
    if(this.model)this.model.modelMatrix=Matrix4.clone(this.matrix);
    this.refresh();
  }
  private refresh(){
    if(this.disposed || this.viewer.isDestroyed() || !this.target)return;
    const info=SATELLITE_MODELS[this.target.id];if(!info)return;
    const distance=this.position?Cartesian3.distance(this.viewer.camera.positionWC,this.position):Infinity;
    if(!modelInRange(distance,Boolean(this.model)||this.loading)){
      if(this.model || this.loading)this.release();
      this.report("far");return;
    }
    if(this.model){this.model.modelMatrix=Matrix4.clone(this.matrix);return;}
    if(this.loading || this.failed)return;
    const token=++this.generation,marker=this.target.marker;
    this.loading=true;this.report("loading");
    const finish=beginWork();this.finish=finish;
    this.timeout=setTimeout(()=>this.fail(token),45_000);
    void Model.fromGltfAsync({url:info.url,modelMatrix:Matrix4.clone(this.matrix),scale:info.span,id:marker,incrementallyLoadTextures:false}).then(model=>{
      if(this.disposed || token!==this.generation || this.viewer.isDestroyed()) {model.destroy();return;}
      this.model=this.viewer.scene.primitives.add(model);this.loading=false;
      // fromGltfAsync resolves before GPU resources are necessarily ready.
      const ready=()=>{
        if(token!==this.generation || this.disposed || this.viewer.isDestroyed())return;
        if(marker.billboard)marker.billboard.show=new ConstantProperty(false);
        clearTimeout(this.timeout);this.timeout=undefined;
        finish();this.finish=null;this.report("ready");this.viewer.scene.requestRender();
      };
      if(model.ready)ready();else model.readyEvent.addEventListener(ready);
      model.errorEvent.addEventListener(()=>this.fail(token));
      this.viewer.scene.requestRender();
    }).catch(()=>this.fail(token)).finally(()=>{if(token!==this.generation)finish();});
  }
  private fail(token:number){
    if(token!==this.generation || this.disposed)return;
    this.release();this.failed=true;this.report("error");
    if(!this.viewer.isDestroyed())this.viewer.scene.requestRender();
  }
  dispose(){this.disposed=true;this.removeRender();this.release();this.target=null;}
}
