import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification, NotificationService } from '../../../services/notification.service';

@Component({selector:'app-notification-center',standalone:true,imports:[CommonModule],templateUrl:'./notification-center.html',styleUrl:'./notification-center.scss'})
export class NotificationCenterComponent {
  private readonly service=inject(NotificationService); private readonly router=inject(Router);
  readonly notifications=this.service.notifications; readonly unreadCount=this.service.unreadCount; readonly browserPermission=this.service.browserPermission;
  readonly open=signal(false); readonly busy=signal(false); readonly error=signal('');
  @Output() notificationOpened=new EventEmitter<AppNotification>();
  toggle():void{this.open.update(v=>!v);this.error.set('');} close():void{this.open.set(false);}
  async enableBrowserNotifications():Promise<void>{try{await this.service.requestPermission();}catch(e){this.error.set(e instanceof Error?e.message:'Notifications could not be enabled.');}}
  async markRead(item:AppNotification):Promise<void>{if(item.is_read)return;try{await this.service.markAsRead(item.id);}catch(e){this.error.set(e instanceof Error?e.message:'Could not mark notification as read.');}}
  async markAllRead():Promise<void>{if(this.busy()||!this.unreadCount())return;this.busy.set(true);try{await this.service.markAllAsRead();}catch(e){this.error.set(e instanceof Error?e.message:'Could not mark notifications as read.');}finally{this.busy.set(false);}}
  async openNotification(item:AppNotification):Promise<void>{await this.markRead(item);this.notificationOpened.emit(item);if(item.action==='people')await this.router.navigate(['/people']);else if(item.action==='chat'&&item.entity_id)await this.router.navigate(['/chat',item.entity_id]);else this.close();}
  notificationIcon(type:string):string{switch(type){case'payment':return'₹';case'employee':return'👤';case'announcement':return'📢';case'chat':return'💬';case'friend':return'🤝';case'security':return'🔒';default:return'✓';}}
  timeAgo(value:string):string{const diff=Math.max(0,Date.now()-new Date(value).getTime()),m=Math.floor(diff/60000);if(m<1)return'Just now';if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;const d=Math.floor(h/24);if(d<7)return`${d}d ago`;return new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short'});}
}
