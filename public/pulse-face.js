importScripts('/vision/vision_bundle.js');
const {FaceLandmarker,FilesetResolver}=Vision;
let detector;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      const files=await FilesetResolver.forVisionTasks(new URL('/vision',self.location.origin).href);
      detector=await FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL('/models/face_landmarker.task',self.location.origin).href,delegate:'CPU'},
        runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,
      });
      self.postMessage({type:'ready'});
    }catch(error){console.warn('Pulse face initialization:',String(error));self.postMessage({type:'error',message:'The local face model could not start. Voice still works.'});}
    return;
  }
  if(data.type==='frame'){
    const start=performance.now();
    try{
      if(!detector)throw new Error();
      const result=detector.detectForVideo(data.bitmap,data.at);
      self.postMessage({type:'result',present:!!result.faceLandmarks?.length,categories:result.faceBlendshapes?.[0]?.categories??[],ms:Math.round(performance.now()-start)});
    }catch{self.postMessage({type:'error',message:'Face tracking paused. Try switching the camera off and on.'});}
    finally{data.bitmap.close();}
  }
};
