import { useEffect, useMemo, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { CLOUD_MAX_AGE_MS, CLOUD_REFRESH_MS, NASA_IR_LAYERS, cloudFrameAt, cloudTileUrl, fetchCloudCatalog, nasaCloudProbeUrl, nasaCloudTileUrl } from "../cloudData";
import { CloudImagery, type CloudImageState } from "../cloudImagery";
import { usePolledData } from "../hooks/usePolledData";
import { useTimeSelector } from "../hooks/useTimeline";
import { beginWork } from "../pendingWork";
import type { TimeController } from "../timeline";

export type CloudStatus = "idle" | "loading" | "ready" | "error" | "nodata" | "fallback";
const EMPTY: CloudImageState={source:null,time:null,sensors:[],loading:false,error:false};

/** Preserve the displayed source until its replacement has actually loaded. */
export function useClouds(viewer: Viewer | null, visible: boolean, opacity: number, timeline: TimeController) {
  const managerRef=useRef<CloudImagery | null>(null);
  const probeRef=useRef<AbortController | null>(null);
  const [image,setImage]=useState<CloudImageState>(EMPTY);
  const poll=usePolledData(fetchCloudCatalog,{enabled:visible && viewer!==null,intervalMs:CLOUD_REFRESH_MS,refreshOnVisible:true,keepDataOnError:true});
  const live=useTimeSelector(timeline,s=>s.live);
  const playing=useTimeSelector(timeline,s=>s.playing);
  const selectedTime=useTimeSelector(timeline,s=>cloudFrameAt(poll.data ?? [],s.time)?.getTime() ?? null);
  const minute=useTimeSelector(timeline,s=>Math.floor(s.time/60_000));
  const frameTimestamp=useMemo(()=>{
    if(!live)return selectedTime;
    const latest=poll.data?.at(-1)?.getTime();
    return latest!==undefined && Date.now()-latest<=CLOUD_MAX_AGE_MS ? latest : null;
  },[poll.data,live,selectedTime,minute]);

  useEffect(()=>{
    if(!viewer)return;
    const manager=new CloudImagery(viewer,setImage);managerRef.current=manager;
    return ()=>{probeRef.current?.abort();manager.dispose();managerRef.current=null;};
  },[viewer]);

  useEffect(()=>{
    const manager=managerRef.current;
    if(!viewer || !manager)return;
    let active=true;
    const controller=new AbortController();
    probeRef.current=controller;
    if(!visible || (!live && frameTimestamp===null)) {
      manager.clear();return ()=>{active=false;controller.abort();};
    }
    if(!live && manager.hasSource("nasa"))manager.clear();
    const fallback=async()=>{
      if(!active || !live || manager.hasSource("nasa") || controller.signal.aborted)return;
      manager.setLoading();
      const done=beginWork();
      // Aborting a superseded attempt must release recording's pending work immediately.
      controller.signal.addEventListener("abort",done,{once:true});
      try {
        const available=await Promise.all(NASA_IR_LAYERS.map(async sensor=>{
          try {
            const response=await fetch(nasaCloudProbeUrl(sensor.id),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12_000)])});
            if(!response.ok || !/^image\/png/i.test(response.headers.get("content-type") ?? ""))return null;
            const bytes=new Uint8Array(await response.arrayBuffer());
            if(bytes.length<100 || bytes[0]!==137 || bytes[1]!==80 || bytes[2]!==78 || bytes[3]!==71)return null;
            // Header alone cannot establish that the image will decode in Cesium.
            const decoded=await createImageBitmap(new Blob([bytes],{type:"image/png"}));decoded.close();
            return sensor;
          }catch{return null;}
        }));
        if(!active || controller.signal.aborted || viewer.isDestroyed())return;
        const sensors=available.filter((s):s is (typeof NASA_IR_LAYERS)[number]=>s!==null);
        if(!sensors.length){manager.setError();return;}
        manager.load({key:"nasa",source:"nasa",time:null,sensors:sensors.map(s=>s.label),maximumLevel:playing?3:5,
          tiles:sensors.map(s=>({url:nasaCloudTileUrl(s.id),credit:`Cloud-top infrared: NASA GIBS / ${s.label}. Regional satellite coverage only.`}))},()=>manager.setError());
      }finally{done();controller.signal.removeEventListener("abort",done);}
    };
    if(frameTimestamp!==null) {
      manager.load({key:`ssec:${frameTimestamp}:${playing?3:5}`,source:"ssec",time:frameTimestamp,sensors:[],maximumLevel:playing?3:5,
        tiles:[{url:cloudTileUrl(new Date(frameTimestamp)),credit:'<a href="https://www.ssec.wisc.edu/realearth/" target="_blank" rel="noopener noreferrer">Cloud imagery: SSEC / UW–Madison RealEarth</a>'}]},()=>{if(active)void fallback();});
    } else if(live && (poll.status==="ready" || poll.status==="error"))void fallback();
    return ()=>{active=false;controller.abort();};
  },[viewer,visible,live,frameTimestamp,poll.data,poll.status,playing]);

  useEffect(()=>{managerRef.current?.setOpacity(opacity);},[viewer,opacity]);
  const status: CloudStatus=!visible?"idle":image.error?"error":image.source==="nasa"?"fallback":image.loading?"loading":image.source==="ssec"?"ready":poll.status==="ready" && frameTimestamp===null?"nodata":poll.status;
  const time=image.time===null?null:new Date(image.time).toISOString().slice(0,16).replace("T"," ")+" UTC";
  return {status,time,fallbackSensors:image.sensors};
}
