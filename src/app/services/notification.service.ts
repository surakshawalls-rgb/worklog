import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export type NotificationType = 'attendance'|'approval'|'payment'|'employee'|'announcement'|'chat'|'friend'|'security'|'system';
export interface AppNotification { id:number; user_id:number; title:string; message:string; type:NotificationType; action:string|null; entity_id:number|null; is_read:boolean; created_at:string; }

@Injectable({providedIn:'root'})
export class NotificationService {
  private readonly supabase=inject(SupabaseService);
  readonly notifications=signal<AppNotification[]>([]);
  readonly unreadCount=signal(0);
  readonly initializedUserId=signal<number|null>(null);
  readonly browserPermission=signal<NotificationPermission|'unsupported'>('unsupported');
  private channel:RealtimeChannel|null=null;

  async initialize(userId:number):Promise<void>{
    if(this.initializedUserId()===userId&&this.channel)return;
    this.unsubscribe(); this.initializedUserId.set(userId);
    if(typeof window!=='undefined'&&'Notification' in window)this.browserPermission.set(window.Notification.permission);
    await this.load(userId); this.subscribe(userId);
  }
  async load(userId=this.initializedUserId()??0):Promise<void>{
    if(!userId)return;
    const {data,error}=await this.supabase.client.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(100);
    if(error)throw error; const rows=(data??[]) as AppNotification[]; this.notifications.set(rows); this.recount();
  }
  async markAsRead(id:number):Promise<void>{
    const {error}=await this.supabase.client.from('notifications').update({is_read:true}).eq('id',id); if(error)throw error;
    this.notifications.update(items=>items.map(x=>x.id===id?{...x,is_read:true}:x)); this.recount();
  }
  async markAllAsRead():Promise<void>{
    const userId=this.initializedUserId(); if(!userId||!this.unreadCount())return;
    const {error}=await this.supabase.client.from('notifications').update({is_read:true}).eq('user_id',userId).eq('is_read',false); if(error)throw error;
    this.notifications.update(items=>items.map(x=>({...x,is_read:true}))); this.unreadCount.set(0);
  }
  async requestPermission():Promise<void>{
    if(typeof window==='undefined'||!('Notification' in window)){this.browserPermission.set('unsupported');return;}
    this.browserPermission.set(await window.Notification.requestPermission());
  }
  show(title:string,body:string,route?:string):void{
    if(typeof window==='undefined'||!('Notification' in window)||window.Notification.permission!=='granted'||!document.hidden)return;
    const n=new window.Notification(title,{body,icon:'/logo.png',tag:'suraksha-hub-notification'});
    if(route)n.onclick=()=>{window.focus();window.location.href=route;};
  }
  async create(userId:number,title:string,message:string,type:NotificationType='system',action:string|null=null,entityId:number|null=null):Promise<void>{
    const {error}=await this.supabase.client.from('notifications').insert({user_id:userId,title,message,type,action,entity_id:entityId}); if(error)throw error;
  }
  async notifyUsers(userIds:number[],title:string,message:string,type:NotificationType='system',action:string|null=null,entityId:number|null=null):Promise<void>{
    const ids=[...new Set(userIds.filter(id=>Number.isFinite(id)))]; if(!ids.length)return;
    const {error}=await this.supabase.client.from('notifications').insert(ids.map(user_id=>({user_id,title,message,type,action,entity_id:entityId}))); if(error)throw error;
  }
  newMessage(name:string,message:string,conversationId:number):void{this.show(`New message from ${name}`,message,`/chat/${conversationId}`);}
  friendRequest(name:string):void{this.show('New friend request',`${name} sent you a connection request.`,'/people');}
  unsubscribe():void{if(this.channel){this.supabase.client.removeChannel(this.channel);this.channel=null;}}
  private subscribe(userId:number):void{
    this.channel=this.supabase.client.channel(`notifications:${userId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${userId}`},payload=>{
      const item=payload.new as AppNotification; this.notifications.update(items=>[item,...items].slice(0,100)); this.recount(); this.show(item.title,item.message,this.routeFor(item.action));
    }).subscribe();
  }
  private routeFor(action:string|null):string|undefined{switch(action){case'people':return'/people';case'chat':return undefined;default:return'/';}}
  private recount():void{this.unreadCount.set(this.notifications().filter(x=>!x.is_read).length);}
}
