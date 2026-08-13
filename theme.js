// THEME TOGGLE
// The initial theme (from localStorage) is already applied by an inline
// script in <head> so there's no flash on load. This file just handles
// switching it afterwards.

function getTheme(){
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function toggleTheme(){
    const next = getTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try{
        localStorage.setItem("bubbles-theme", next);
    }catch(e){}
    const btn = document.getElementById("themeToggleBtn");
    if(btn){
        btn.textContent = next === "dark" ? "☀️" : "🌙";
        btn.title = next === "dark" ? "Светлая тема" : "Тёмная тема";
    }
}
