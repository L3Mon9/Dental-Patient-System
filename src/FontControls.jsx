import { useEffect, useState } from 'react'
export default function FontControls() {
 const [size,setSize] = useState(()=>{try {const value=Number(localStorage.getItem('jhon-font-size'));return [14,16,18,20].includes(value)?value:16} catch{return 16}})
 const [theme,setTheme] = useState(()=>document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
 useEffect(()=>{document.documentElement.style.setProperty('--app-font-size',`${size}px`);try{localStorage.setItem('jhon-font-size',String(size))}catch{/* Preference storage is optional. */}},[size])
 useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('jhon-theme',theme)}catch{/* Preference storage is optional. */}},[theme])
 return <div className="font-controls" aria-label="Display preferences"><span aria-hidden="true">Aa</span><label htmlFor="text-size">Text size</label><select id="text-size" value={size} onChange={e=>setSize(Number(e.target.value))}><option value="14">Compact</option><option value="16">Comfortable</option><option value="18">Large</option><option value="20">Extra large</option></select><button className="theme-toggle" type="button" aria-label="Toggle dark mode" aria-pressed={theme==='dark'} onClick={()=>setTheme(value=>value==='dark'?'light':'dark')}><span aria-hidden="true">{theme==='dark'?'☾':'☀'}</span>{theme==='dark'?'Dark':'Light'}</button></div>
}
