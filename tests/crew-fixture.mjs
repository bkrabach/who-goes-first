// Existing-user fixture, not the product's ephemeral sample crew.
export const savedCrew=['Kevin Flynn','Andrew Wiggin','Frodo Baggins','Inigo Montoyo','Rick Deckard','Dade Murphy','Mazer Rackham','Richard Riddick','Thomas Anderson'].map((name,i)=>({id:`original-${i}`,name,active:i<6}));
export async function seedSavedCrew(context){
  await context.addInitScript(crew=>{
    const key='who-goes-first:players:v1';
    if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify({version:1,kind:'crew',players:crew}));
  },savedCrew);
}