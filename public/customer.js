import {customerPhone,esc} from './customer-view.js';
const root=document.querySelector('#customer');
const params=new URLSearchParams(location.search);const token=params.get('token'),customerId=params.get('customerId');
let refreshing=false;
async function refresh(){if(refreshing)return;refreshing=true;let data=null,error='';const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5000);try{if(!token||!customerId)throw new Error('이 고객의 유효한 안내 링크가 필요해요.');const response=await fetch(`/api/customer-links/${encodeURIComponent(token)}?customerId=${encodeURIComponent(customerId)}`,{signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.error?.message||'이 고객의 안내를 찾을 수 없어요.');data=body;}catch(e){error=e.message;}finally{clearTimeout(timeout);refreshing=false;}root.innerHTML=`<div class="standalone-brand">mobflow. <span>내 이동 안내</span></div>${customerPhone(data,{error})}<p class="customer-caption">가상 데이터와 모의 알림만 사용하는 로컬 시연입니다.<br>실제 위치·고객 인증·카카오톡 연결은 없습니다.</p>`;}
await refresh();setInterval(refresh,3000);
