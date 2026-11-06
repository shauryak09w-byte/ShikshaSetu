package com.shikshasetu.portal;
public final class PortalAuthContext {
 private static final ThreadLocal<PortalPrincipal> CURRENT=new ThreadLocal<>(); private PortalAuthContext(){}
 public static void set(PortalPrincipal p){CURRENT.set(p);} public static PortalPrincipal get(){return CURRENT.get();}
 public static PortalPrincipal require(){PortalPrincipal p=CURRENT.get();if(p==null)throw new IllegalStateException("Authenticated portal session required");return p;}
 public static void clear(){CURRENT.remove();}
}
