/** Default product composition uses only the general task and delivery tools. */
import {createPrimaryAgentWorker,primaryTools as coreTools,primaryInstructions as coreInstructions} from './primary-runtime.js';
import type {ChatOptions} from './chat-options.js';
import type {PrimaryCapabilityFactory} from './primary-capability.js';
export {createPrimaryTasks} from './primary-runtime.js';
export type {DispatchLink} from './primary-task-contract.js';
export const primaryTools=coreTools;
export const primaryInstructions=coreInstructions;
export function primaryAgentWorker(root:string,command:string,options:ChatOptions,taskDirectory:string,onSession:(id:string)=>Promise<void>,previousDelivery?:string,onGoal?:(goal:import('./native-goal.js').NativeGoal)=>Promise<void>,capabilityFactory?:PrimaryCapabilityFactory){
 return createPrimaryAgentWorker(root,command,options,taskDirectory,onSession,previousDelivery,onGoal,capabilityFactory);
}
