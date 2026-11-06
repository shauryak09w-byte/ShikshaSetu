package com.shikshasetu.service;
import com.shikshasetu.model.PortalUser;import com.shikshasetu.portal.PortalPasswordHasher;import com.shikshasetu.repo.PortalUserRepository;import org.springframework.beans.factory.annotation.Value;import org.springframework.boot.ApplicationArguments;import org.springframework.boot.ApplicationRunner;import org.springframework.core.annotation.Order;import org.springframework.stereotype.Component;
@Component @Order(2) public class SuperAdminBootstrap implements ApplicationRunner{
 private final PortalUserRepository users;@Value("${shikshasetu.bootstrap.super-admin-email:}") private String email;@Value("${shikshasetu.bootstrap.super-admin-password:}") private String password;
 public SuperAdminBootstrap(PortalUserRepository u){users=u;}
 @Override public void run(ApplicationArguments args){if(email==null||email.isBlank()||password==null||password.length()<14)return;String clean=email.trim().toLowerCase();if(users.findByEmailIgnoreCase(clean).isPresent())return;PortalUser u=new PortalUser();u.setEmail(clean);u.setFullName("ShikshaSetu Platform Administrator");u.setPasswordHash(PortalPasswordHasher.hash(password));u.setRole("SUPER_ADMIN");u.setAccountStatus("ACTIVE");u.setChatMonitoringConsent(false);users.save(u);}
}
