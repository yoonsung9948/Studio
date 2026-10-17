import { beforeEach, expect, it } from "vitest";
import { useSelection, type EntityKey } from "../studio/selection";
const order:EntityKey[]=["shot:a","shot:b","shot:c","shot:d"];
beforeEach(()=>useSelection.getState().replace([]));
it("selects, toggles and extends an anchored range",()=>{
  const choose=useSelection.getState().choose;
  choose(order[1],order);choose(order[3],order,{shiftKey:true});
  expect(useSelection.getState().keys).toEqual(order.slice(1));
  choose(order[2],order,{metaKey:true});expect(useSelection.getState().keys).toEqual([order[1],order[3]]);
  choose(order[0],order);expect(useSelection.getState().keys).toEqual([order[0]]);
});
