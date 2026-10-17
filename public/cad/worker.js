/* Local OCCT loader. Terminating this Worker cancels CPU-intensive conversion. */
importScripts('./occt-import-js.js');
self.onmessage = async ({data}) => {
  try {
    const occt = await occtimportjs({locateFile: file => new URL(file, self.location.href).href, print:()=>{}, printErr:()=>{}});
    const result = occt.ReadStepFile(new Uint8Array(data), {linearUnit:'meter',linearDeflectionType:'bounding_box_ratio',linearDeflection:0.002,angularDeflection:0.3});
    if (!result.success || !result.meshes?.length) throw new Error('STEP 未包含可显示的实体，或文件无法解析');
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error.message || String(error)}); }
};
