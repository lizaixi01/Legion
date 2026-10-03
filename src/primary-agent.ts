/** Product composition; the primary runtime itself has no HWE dependency. */
import {createPrimaryAgentWorker,primaryTools as coreTools,primaryInstructions as coreInstructions} from './primary-runtime.js';
import {createHwePrimaryCapability,hwePrimaryTools,hwePrimaryInstructions} from './hwe-primary-capability.js';
import type {ChatOptions} from './chat-options.js';
import type {PrimaryCapabilityFactory} from './primary-capability.js';
export {createPrimaryTasks} from './primary-runtime.js';
export type {DispatchLink} from './primary-task-contract.js';
export const primaryTools=[coreTools[0]!,...hwePrimaryTools,...coreTools.slice(1)];
export const primaryInstructions=coreInstructions+'\n'+hwePrimaryInstructions;
export function primaryAgentWorker(root:string,command:string,options:ChatOptions,taskDirectory:string,onSession:(id:string)=>Promise<void>,previousDelivery?:string,onGoal?:(goal:import('./native-goal.js').NativeGoal)=>Promise<void>,capabilityFactory:PrimaryCapabilityFactory=createHwePrimaryCapability){
 return createPrimaryAgentWorker(root,command,options,taskDirectory,onSession,previousDelivery,onGoal,capabilityFactory);
}
