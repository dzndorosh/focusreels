import { describe, expect, it } from 'vitest';
import { rankCatalog, validateCatalog, catalogFromEnvironment, type YouTubeShortItem } from '../src/youtube/catalog.js';
const item=(id:string,category:any='humor'):YouTubeShortItem=>({id,videoId:id,category,weight:1,enabled:true,addedAt:'2024-01-01'});
describe('youtube catalog',()=>{
 it('turns development environment IDs into a deduplicated catalog',()=>{const c=catalogFromEnvironment('abc123,abc123, bad,valid_1');expect(c?.videos.map(x=>x.videoId)).toEqual(['abc123','valid_1']);});
 it('validates, deduplicates and rejects malformed entries',()=>{const c=validateCatalog({schemaVersion:1,generatedAt:'now',videos:[item('abcdef'),item('abcdef'),{...item('bad'),videoId:'x'}]});expect(c?.videos).toHaveLength(1);});
 it('hides hidden feedback and penalizes quick skips',()=>{const xs=[item('abcdef'),item('ghijkl'),item('mnopqr')];const r=rankCatalog(xs,[{videoId:'abcdef',category:'humor',impressions:1,completedViews:0,quickSkips:3},{videoId:'ghijkl',category:'humor',hidden:true,impressions:1,completedViews:0,quickSkips:0}],new Set(),()=>0);expect(r.map(x=>x.videoId)).toEqual(['mnopqr','abcdef']);});
});
