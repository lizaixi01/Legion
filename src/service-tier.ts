import {z} from 'zod';

/** Omitted preserves legacy behavior; default explicitly turns Fast off. */
export const ServiceTierSchema=z.enum(['default','fast','priority']);
export type ServiceTier=z.infer<typeof ServiceTierSchema>;
export function advertisesFast(model:{service_tiers?:{id:string}[];additional_speed_tiers?:string[]}){
 return !!(model.service_tiers?.some(t=>t.id==='fast'||t.id==='priority')||model.additional_speed_tiers?.includes('fast'));
}
export function tierConfig(tier:ServiceTier|undefined):string[]{
 return tier===undefined?[]:['-c',`service_tier=${JSON.stringify(tier)}`,'--enable','fast_mode'];
}
