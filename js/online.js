/* ===================================
   BUBBLES ONLINE STATUS
   HEARTBEAT SYSTEM
=================================== */


(function(){


const sb =
window.bubblesSupabase;



if(!sb){

console.error(
"❌ Supabase не найден"
);

return;

}



console.log(
"🟢 Online system запускается..."
);



let currentUser = null;



async function getCurrentUser(){


const {
data:{
user
}

}= await sb.auth.getUser();



if(user){

currentUser = user;

}

}





async function updateOnline(){


if(!currentUser)
return;



const now =
new Date()
.toISOString();



const {
error
}= await sb
.from("profiles")
.update({

last_seen: now

})

.eq(
"id",
currentUser.id
);



if(error){

console.error(
"Ошибка online:",
error
);

}

else{


console.log(
"🟢 Online обновлён:",
now
);


}


}





async function startOnline(){


await getCurrentUser();



if(!currentUser){

console.log(
"Нет пользователя"
);

return;

}



updateOnline();



// каждые 30 секунд

setInterval(

()=>{

updateOnline();

},

30000

);



}





startOnline();



})();
