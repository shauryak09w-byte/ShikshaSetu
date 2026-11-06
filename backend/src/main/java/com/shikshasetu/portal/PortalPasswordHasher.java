package com.shikshasetu.portal;
import javax.crypto.SecretKeyFactory; import javax.crypto.spec.PBEKeySpec; import java.security.SecureRandom; import java.util.Base64;
public final class PortalPasswordHasher {
 private static final int ITERATIONS=600_000; private static final SecureRandom RANDOM=new SecureRandom(); private PortalPasswordHasher(){}
 public static String hash(String password){try{byte[] salt=new byte[16];RANDOM.nextBytes(salt);byte[] derived=derive(password,salt,ITERATIONS);return "pbkdf2$"+ITERATIONS+"$"+Base64.getEncoder().encodeToString(salt)+"$"+Base64.getEncoder().encodeToString(derived);}catch(Exception e){throw new IllegalStateException("Password hashing failed",e);}}
 public static boolean matches(String password,String encoded){try{String[] p=encoded.split("\\$");if(p.length!=4||!"pbkdf2".equals(p[0]))return false;int it=Integer.parseInt(p[1]);if(it<100_000||it>1_000_000)return false;byte[] expected=Base64.getDecoder().decode(p[3]);byte[] actual=derive(password,Base64.getDecoder().decode(p[2]),it);if(expected.length!=actual.length)return false;int diff=0;for(int i=0;i<expected.length;i++)diff|=expected[i]^actual[i];return diff==0;}catch(Exception e){return false;}}
 private static byte[] derive(String password,byte[] salt,int iterations)throws Exception{PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,iterations,256);try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}finally{spec.clearPassword();}}
}
