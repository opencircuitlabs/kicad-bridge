import{XMLParser}from'fast-xml-parser';
export class KiCadBridgeError extends Error{constructor(message){super(message);this.name='KiCadBridgeError';}}
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',trimValues:true,isArray:(name,path)=>['export.components.comp','export.nets.net','export.nets.net.node','export.components.comp.fields.field'].includes(path)});
const typeMap=[
  {match:/^(Device:)?R(_.*)?$/i,type:'resistor',field:'resistance',prefix:'R',lib:'Device',part:'R'},
  {match:/^(Device:)?C(_.*)?$/i,type:'capacitor',field:'capacitance',prefix:'C',lib:'Device',part:'C'},
  {match:/^(Device:)?L(_.*)?$/i,type:'inductor',field:'inductance',prefix:'L',lib:'Device',part:'L'},
  {match:/^(Device:)?D(_.*)?$/i,type:'diode',prefix:'D',lib:'Device',part:'D'},
  {match:/^(Device:)?LED(_.*)?$/i,type:'led',prefix:'LED',lib:'Device',part:'LED'},
  {match:/^(Simulation_SPICE:)?V(DC)?$/i,type:'voltage-source',field:'voltage',prefix:'V',lib:'Simulation_SPICE',part:'VDC'},
  {match:/^(Simulation_SPICE:)?I(DC)?$/i,type:'current-source',field:'current',prefix:'I',lib:'Simulation_SPICE',part:'IDC'}
];

export function importKiCadNetlist(xml,{groundNames=['0','GND','VSS'],onUnsupported='warn'}={}){
  if(typeof xml!=='string'||!xml.trim())throw new KiCadBridgeError('KiCad netlist XML must be a non-empty string');let document;try{document=parser.parse(xml);}catch(error){throw new KiCadBridgeError(`invalid XML: ${error.message}`);}const root=document?.export;if(!root)throw new KiCadBridgeError('expected KiCad <export> root');
  const rawComponents=array(root.components?.comp),rawNets=array(root.nets?.net);if(rawComponents.length===0)throw new KiCadBridgeError('netlist contains no components');
  const netRecords=rawNets.map((net,index)=>({code:String(net['@_code']??index+1),name:String(net['@_name']??`Net-${index+1}`),nodes:array(net.node).map(node=>({ref:String(node['@_ref']??''),pin:String(node['@_pin']??'')}))}));
  const usedIds=new Set();const groundRecord=netRecords.find(net=>groundNames.some(name=>name.toLowerCase()===net.name.toLowerCase()));const ground=groundRecord?safeId(groundRecord.name,usedIds):'0';if(!groundRecord)usedIds.add(ground);
  const netToId=new Map(netRecords.map(net=>[net.code,net===groundRecord?ground:safeId(net.name,usedIds)]));const pinsByRef=new Map();for(const net of netRecords)for(const node of net.nodes){if(!pinsByRef.has(node.ref))pinsByRef.set(node.ref,[]);pinsByRef.get(node.ref).push({pin:node.pin,node:netToId.get(net.code),netName:net.name});}
  const components=[],warnings=[],unmapped=[],componentMetadata={};
  for(const raw of rawComponents){const ref=String(raw['@_ref']??''),value=String(raw.value??''),lib=String(raw.libsource?.['@_lib']??''),part=String(raw.libsource?.['@_part']??''),identifier=lib?`${lib}:${part}`:part,mapping=findMapping(identifier,ref);const pins=(pinsByRef.get(ref)??[]).sort(pinCompare);
    if(!mapping||pins.length!==2){const reason=!mapping?`unsupported symbol ${identifier||'<unknown>'}`:`expected 2 connected pins, found ${pins.length}`;unmapped.push({ref,value,lib,part,reason,pins});if(onUnsupported==='error')throw new KiCadBridgeError(`${ref}: ${reason}`);if(onUnsupported==='warn')warnings.push(`${ref}: ${reason}`);continue;}
    const component={id:uniqueRef(ref,components),type:mapping.type,from:pins[0].node,to:pins[1].node};if(value)component.label=value;if(mapping.field){const numeric=parseEngineeringValue(value,mapping.field);if(numeric===undefined){warnings.push(`${ref}: could not parse ${mapping.field} value "${value}"`);component[mapping.field]=defaultValue(mapping.field);}else component[mapping.field]=numeric;}components.push(component);componentMetadata[component.id]={reference:ref,library:lib,part,value,fields:Object.fromEntries(array(raw.fields?.field).map(field=>[String(field['@_name']??''),String(field['#text']??field)])),pins};
  }
  const nodes=netRecords.map(net=>({id:netToId.get(net.code),...(net.name!==netToId.get(net.code)?{label:net.name}:{})}));if(!nodes.some(node=>node.id===ground))nodes.unshift({id:ground,label:'Ground'});
  const circuit={format:'opencircuit',version:'1.0',metadata:{name:String(root.design?.sheet?.title_block?.title??root.design?.source??'Imported KiCad netlist'),description:'Imported from a KiCad generic XML netlist.'},ground,nodes,components,extensions:{'org.opencircuitlabs.kicad':{source:String(root.design?.source??''),date:String(root.design?.date??''),tool:String(root.design?.tool??''),componentMetadata,unmapped}}};
  return{circuit,warnings,unmapped};
}

export function exportKiCadNetlist(circuit,{source='opencircuit.kicad_sch',date=new Date(0).toISOString(),tool='OpenCircuitLabs kicad-bridge'}={}){
  validateCircuit(circuit);const metadata=circuit.extensions?.['org.opencircuitlabs.kicad']?.componentMetadata??{},refs=assignReferences(circuit.components,metadata),nodeById=new Map(circuit.nodes.map(node=>[node.id,node]));const components=circuit.components.map(component=>{const mapping=typeMap.find(item=>item.type===component.type);if(!mapping)throw new KiCadBridgeError(`cannot export component type "${component.type}"`);const ref=refs.get(component.id),value=formatComponentValue(component,mapping),prior=metadata[component.id]??{};return{component,ref,value,lib:prior.library??mapping.lib,part:prior.part??mapping.part};});
  const netPins=new Map(circuit.nodes.map(node=>[node.id,[]]));for(const entry of components){netPins.get(entry.component.from).push({ref:entry.ref,pin:'1'});netPins.get(entry.component.to).push({ref:entry.ref,pin:'2'});}
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<export version="D">','  <design>',`    <source>${escapeXml(source)}</source>`,`    <date>${escapeXml(date)}</date>`,`    <tool>${escapeXml(tool)}</tool>`,'  </design>','  <components>'];
  for(const entry of components)lines.push(`    <comp ref="${escapeXml(entry.ref)}">`,`      <value>${escapeXml(entry.value)}</value>`,`      <libsource lib="${escapeXml(entry.lib)}" part="${escapeXml(entry.part)}"/>`,'    </comp>');lines.push('  </components>','  <libparts>');
  for(const entry of uniqueBy(components,item=>`${item.lib}:${item.part}`))lines.push(`    <libpart lib="${escapeXml(entry.lib)}" part="${escapeXml(entry.part)}">`,`      <pins><pin num="1" name="1" type="passive"/><pin num="2" name="2" type="passive"/></pins>`,'    </libpart>');lines.push('  </libparts>','  <nets>');
  circuit.nodes.forEach((node,index)=>{const name=node.id===circuit.ground?'GND':node.label??node.id;lines.push(`    <net code="${index+1}" name="${escapeXml(name)}">`);for(const pin of netPins.get(node.id)??[])lines.push(`      <node ref="${escapeXml(pin.ref)}" pin="${pin.pin}"/>`);lines.push('    </net>');});lines.push('  </nets>','</export>');return`${lines.join('\n')}\n`;
}

export function createBOM(circuit){validateCircuit(circuit);const metadata=circuit.extensions?.['org.opencircuitlabs.kicad']?.componentMetadata??{},refs=assignReferences(circuit.components,metadata),groups=new Map();for(const component of circuit.components){const mapping=typeMap.find(item=>item.type===component.type),value=formatComponentValue(component,mapping),key=`${component.type}|${value}`;if(!groups.has(key))groups.set(key,{type:component.type,value,references:[],quantity:0});const group=groups.get(key);group.references.push(refs.get(component.id));group.quantity++;}return[...groups.values()].map(group=>({...group,references:group.references.sort(naturalCompare)})).sort((a,b)=>a.references[0].localeCompare(b.references[0],undefined,{numeric:true}));}
export function bomToCSV(bom){return['Quantity,References,Type,Value',...bom.map(row=>[row.quantity,row.references.join(' '),row.type,row.value].map(csvCell).join(','))].join('\n')+'\n';}

export function parseEngineeringValue(text,field){const normalized=String(text).trim().replace(/Ω|ohms?/ig,'').replace(/farads?|henr(y|ies)|volts?|amps?/ig,'').trim();const match=/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*)([pnumkKMGT]?)(?:[A-Za-z]*)$/.exec(normalized);if(!match)return undefined;const value=Number(match[1]),suffix=match[2],multipliers={p:1e-12,n:1e-9,u:1e-6,m:1e-3,k:1e3,K:1e3,M:1e6,G:1e9,T:1e12};let multiplier=multipliers[suffix]??1;if(field!=='resistance'&&suffix==='M')multiplier=1e6;return value*multiplier;}

function findMapping(identifier,ref){return typeMap.find(item=>item.match.test(identifier))??typeMap.find(item=>ref.toUpperCase().startsWith(item.prefix));}
function formatComponentValue(component,mapping){const field=mapping?.field;if(!field)return component.label??component.type;const value=component[field];return component.label&&!Number.isFinite(parseEngineeringValue(component.label,field))?formatSI(value):component.label??formatSI(value);}
function formatSI(value){const scales=[[1e12,'T'],[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'u'],[1e-9,'n'],[1e-12,'p']];const[scale,suffix]=scales.find(([scale])=>Math.abs(value)>=scale)??scales.at(-1);return`${Number((value/scale).toPrecision(6))}${suffix}`;}
function assignReferences(components,metadata){const result=new Map(),counts={};for(const component of components){const prior=metadata[component.id]?.reference;if(prior){result.set(component.id,prior);continue;}const mapping=typeMap.find(item=>item.type===component.type),prefix=mapping?.prefix??'U';counts[prefix]=(counts[prefix]??0)+1;result.set(component.id,/^[A-Za-z]+\d+$/.test(component.id)?component.id:`${prefix}${counts[prefix]}`);}return result;}
function safeId(name,used){let base=String(name).trim().replace(/[^A-Za-z0-9_.:-]+/g,'-').replace(/^-+|-+$/g,'')||'net';if(!/^[A-Za-z0-9]/.test(base))base=`net-${base}`;let candidate=base,index=2;while(used.has(candidate))candidate=`${base}-${index++}`;used.add(candidate);return candidate;}
function uniqueRef(ref,components){let candidate=ref||`U${components.length+1}`,index=2;while(components.some(component=>component.id===candidate))candidate=`${ref}-${index++}`;return candidate;}
function pinCompare(a,b){return naturalCompare(a.pin,b.pin);}
function naturalCompare(a,b){return String(a).localeCompare(String(b),undefined,{numeric:true});}
function array(value){return value===undefined?[]:Array.isArray(value)?value:[value];}
function uniqueBy(items,key){const seen=new Set();return items.filter(item=>{const value=key(item);if(seen.has(value))return false;seen.add(value);return true;});}
function defaultValue(field){return{resistance:1000,capacitance:1e-6,inductance:1e-3,voltage:0,current:0}[field];}
function escapeXml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
function csvCell(value){const text=String(value);return/[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
function validateCircuit(circuit){if(!circuit||!Array.isArray(circuit.nodes)||!Array.isArray(circuit.components))throw new KiCadBridgeError('circuit requires nodes and components arrays');const nodes=new Set(circuit.nodes.map(node=>node.id));if(!nodes.has(circuit.ground))throw new KiCadBridgeError('ground node is missing');for(const component of circuit.components)if(!nodes.has(component.from)||!nodes.has(component.to))throw new KiCadBridgeError(`${component.id} references an unknown node`);}
